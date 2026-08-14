import { useCallback, useEffect, useRef, useState } from 'react'
import { createStory } from '@kiny/engine'
import type { ValidatedProgram, Story } from '@kiny/engine'
import {
  initialState, step, chooseStep, submitInputStep, replayToStory,
  type PlayState, type ResolveAsset, type RevealBinding, type InteractionStep, type AdvanceResult,
  type AwaitKind,
} from '@kiny/player'

/**
 * editor 预览面板专属的打字机播放层：只在人工点选项 / 提交输入 / 点重开预览时启动一次动画。
 * 编辑重算（App 的 onValidated/recompute）与 AI 的 PreviewPort 都**不经过这里**——它们只应
 * 重建静态预览，一旦借道本 hook 就会在每次敲键时重放打字机动画。每一步的中间 PlayState 都经 onCommit 写回调用方
 * 状态，本 hook 自身不持有 play / 交互序列。
 */
export interface PreviewPlayback {
  /** 是否有动画正在进行(供调用方决定要不要把 reveal/onContentClick 传给 <Player>)。 */
  active: boolean
  reveal: RevealBinding | undefined
  onContentClick: (() => void) | undefined
  /** 从故事开头完整播一遍(等价 usePlayback 挂载时的行为)。 */
  restart: (program: ValidatedProgram, start: string, seed: number, resolve: ResolveAsset) => void
  /** 瞬时补到 priorSeq 的位置，再对新追加的这一步(pos)播动画。 */
  choose: (
    program: ValidatedProgram, start: string, seed: number,
    priorSeq: InteractionStep[], pos: number, resolve: ResolveAsset,
  ) => void
  /** 对偶 choose：瞬时补到 priorSeq 的位置(停在输入暂停点)，再对提交的这一步(text)播后续正文动画。 */
  submit: (
    program: ValidatedProgram, start: string, seed: number,
    priorSeq: InteractionStep[], text: string, resolve: ResolveAsset,
  ) => void
  /** 立即中止在飞动画(不再提交任何后续状态)。编辑触发重算时调用，编辑优先。 */
  cancel: () => void
}

/** 快进时给下游的空音效数组。提到模块级：每次 commit 新建会让引用每行都变，白白多一轮渲染。 */
const NO_SFX: string[] = []

/**
 * @param fastForward 快进（作者调试开关）：旁路掉**全部演出等待**——正文瞬显、句中 `<pause>`
 *   两档不停、`@sleep` 不等、`line` 模式自动流过，音效一律不发（旁路等待后原本隔开的几个
 *   音效会挤成一声噪响；与「← 上一步」不重放音效同口径）。只作用于预览，不碰作品数据。
 *   作品里的环由 engine 的 `STEP_BUDGET` 兜住（超限报「疑似死循环」），此处不另设保护。
 */
export function usePreviewPlayback(
  onCommit: (state: PlayState, sfx: string[]) => void,
  fastForward = false,
): PreviewPlayback {
  const [active, setActive] = useState(false)
  // 放 ref：commit / onLatestRevealed 在 timer 与揭示回调里跑，不能读闭包快照。
  const fastForwardRef = useRef(fastForward)
  fastForwardRef.current = fastForward
  const [skipToken, setSkipToken] = useState(0)
  // line 模式：最新行已显示完、等点击出下一行（Player 据此亮推进提示三角）。
  const [awaitingClick, setAwaitingClick] = useState(false)
  const storyRef = useRef<Story | null>(null)
  const resolveRef = useRef<ResolveAsset>((n) => n)
  const lastStateRef = useRef<PlayState>(initialState)
  const revealingRef = useRef(false)
  /** 最新一行正停在句中 `<pause>` 标记处的档位（RevealingLine 上报），参与点击门控。 */
  const awaitingPauseRef = useRef<AwaitKind>(null)
  // 代龄计数：当前所有 commit 都同步发起，故下面 commit 里的 gen 校验实际不会命中——
  // cancel 的真正生效靠 storyRef=null（令在飞 timer 回调的 doStep 早退）+ setActive(false)。
  // genRef 是为「将来若改成异步调度 commit」留的防线；届时 storyRef=null 不再足够，代龄校验才兜底。
  const genRef = useRef(0)
  // @sleep 演出停顿：人工交互的预览按真实时长等待（编辑重算走 replay，那条路径直接吞 sleep、零等待）。
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waitingSleepRef = useRef(false)
  const doStepRef = useRef<() => void>(() => {})
  const clearSleep = useCallback(() => {
    if (sleepTimerRef.current !== null) {
      clearTimeout(sleepTimerRef.current)
      sleepTimerRef.current = null
    }
    waitingSleepRef.current = false
  }, [])

  const cancel = useCallback(() => {
    genRef.current++
    storyRef.current = null
    revealingRef.current = false
    clearSleep() // 编辑触发重算：在飞的停顿也一并作废（编辑优先）
    setActive(false)
    setAwaitingClick(false)
  }, [clearSleep])

  // 卸载：清掉未决停顿定时器。
  useEffect(() => clearSleep, [clearSleep])

  const commit = useCallback((gen: number, state: PlayState, sfx: string[], pendingSleep?: number) => {
    if (gen !== genRef.current) return // 已被 cancel / 新一轮 restart-choose 取代
    lastStateRef.current = state
    onCommit(state, fastForwardRef.current ? NO_SFX : sfx)
    setAwaitingClick(false) // 新状态：要么开始打新行，要么抵暂停点——都不在「等点击」
    clearSleep()
    if (pendingSleep !== undefined) {
      revealingRef.current = false // 停顿中：既不在揭示、也不在等读者
      waitingSleepRef.current = true
      // 快进：零延时续步。仍走 timer 而不同步调 doStep——同步会在 commit 内重入，
      // 且绕开「停顿在飞时被 cancel / 新状态作废」这条既有路径。
      sleepTimerRef.current = setTimeout(() => {
        sleepTimerRef.current = null
        waitingSleepRef.current = false
        doStepRef.current()
      }, fastForwardRef.current ? 0 : pendingSleep)
      return
    }
    revealingRef.current = !(state.ended || state.choices.length > 0 || state.input !== null || state.error != null)
    if (!revealingRef.current) setActive(false) // 抵暂停点（含 @input 输入框）：动画收尾
  }, [onCommit, clearSleep])

  const doStep = useCallback(() => {
    const gen = genRef.current
    const story = storyRef.current
    if (story == null) return
    const r = step(story, lastStateRef.current, resolveRef.current)
    commit(gen, r.state, r.sfx, r.pendingSleep)
  }, [commit])
  doStepRef.current = doStep

  /**
   * 拨开快进的那一刻，把**已经在等**的两种情况就地放行。
   *
   * 作者点「快进」最自然的时机恰恰是盯着不动的画面时，而这两种等待都不会自己醒过来：
   * - `@sleep` 的时长在布防那一刻就定死了（且停顿本不可点击跳过）——重新以零延时布防；
   * - `line` 模式停在行尾等点击时，那一行的 `onComplete` 已按行去重触发过、不会再来一次
   *   （揭示侧的 `firedRef`），故链条断在这里——直接续一步把它带起来。
   * 不这么做的话，「拨开关时正在等待」＝ 开关当场无效，要再点一下才生效。
   */
  useEffect(() => {
    if (!fastForward) return
    if (waitingSleepRef.current && sleepTimerRef.current !== null) {
      clearTimeout(sleepTimerRef.current)
      sleepTimerRef.current = setTimeout(() => {
        sleepTimerRef.current = null
        waitingSleepRef.current = false
        doStepRef.current()
      }, 0)
      return
    }
    if (awaitingClick) doStep()
  }, [fastForward, awaitingClick, doStep])

  const run = useCallback((story: Story, resolve: ResolveAsset, first: AdvanceResult) => {
    genRef.current++
    const gen = genRef.current
    storyRef.current = story
    resolveRef.current = resolve
    revealingRef.current = false
    setActive(true)
    commit(gen, first.state, first.sfx, first.pendingSleep)
  }, [commit])

  const restart = useCallback((program: ValidatedProgram, start: string, seed: number, resolve: ResolveAsset) => {
    const story = createStory(program, { start, seed })
    run(story, resolve, step(story, initialState, resolve))
  }, [run])

  const choose = useCallback((
    program: ValidatedProgram, start: string, seed: number,
    priorSeq: InteractionStep[], pos: number, resolve: ResolveAsset,
  ) => {
    const r = replayToStory(program, start, seed, priorSeq, resolve)
    const idx = r.state.choices[pos]?.index
    if (idx == null) return
    run(r.story, resolve, chooseStep(r.story, r.state, idx, resolve))
  }, [run])

  const submit = useCallback((
    program: ValidatedProgram, start: string, seed: number,
    priorSeq: InteractionStep[], text: string, resolve: ResolveAsset,
  ) => {
    const r = replayToStory(program, start, seed, priorSeq, resolve)
    if (r.state.input === null) return // 重放没停在输入暂停点（脚本变化）→ 放弃动画，等编辑重算恢复
    run(r.story, resolve, submitInputStep(r.story, r.state, text, resolve))
  }, [run])

  const onLatestRevealed = useCallback(() => {
    revealingRef.current = false
    const cur = lastStateRef.current
    // 快进无视 stepMode：line 模式本该等点击，调试时那也是演出节奏，一并流过。
    if (fastForwardRef.current || cur.host.stepMode === 'flow') {
      doStep()
      return
    }
    const atPause = cur.ended || cur.choices.length > 0 || cur.input !== null || cur.error != null
    if (!atPause) setAwaitingClick(true) // line 模式：等点击出下一行 → 亮推进提示
  }, [doStep])

  const onContentClick = useCallback(() => {
    if (waitingSleepRef.current) return // @sleep 停顿不可跳过（与 usePlayback 同语义）
    if (awaitingPauseRef.current === 'timed') return // 毫秒档 <pause=毫秒> 等待中点击完全无效（同 @sleep）
    // 打字中 → 当前段立显；停在句中点击档 `<pause>` → 续下一段（两者都递增 skipToken，由 RevealingLine 分档）。
    if (revealingRef.current || awaitingPauseRef.current) { setSkipToken((t) => t + 1); return }
    const cur = lastStateRef.current
    const atPause = cur.ended || cur.choices.length > 0 || cur.input !== null || cur.error != null
    if (!atPause && cur.host.stepMode === 'line') doStep() // 已显示完、逐行模式 → 下一行
  }, [doStep])

  // 句中点击档 `<pause>` 停在标记处 = 另一种「等你点击」；毫秒档只参与门控、不亮三角（与 usePlayback 同语义）。
  const onAwaitingPause = useCallback((waiting: AwaitKind) => {
    awaitingPauseRef.current = waiting
    setAwaitingClick(waiting === 'click')
  }, [])

  // 快进时速度 / 淡入取 0 且要求 instant：前者让整行瞬显，后者额外把句中 `<pause>` 两档一并跳过
  //（单靠 speed=0 跳不过——那是作者的作品设定，RevealingLine 会保留分段停顿）。
  const reveal: RevealBinding | undefined = active
    ? {
        speed: fastForward ? 0 : lastStateRef.current.host.textSpeed,
        fade: fastForward ? 0 : lastStateRef.current.host.textFade,
        instant: fastForward,
        skipToken, onLatestRevealed, onAwaitingPause, awaitingClick,
      }
    : undefined

  return { active, reveal, onContentClick: active ? onContentClick : undefined, restart, choose, submit, cancel }
}
