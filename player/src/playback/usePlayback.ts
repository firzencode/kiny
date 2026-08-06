import { useCallback, useEffect, useRef, useState } from 'react'
import type { Story } from '@kiny/engine'
import { initialState, step, chooseStep, submitInputStep, type PlayState } from '../driver/storyDriver'
import type { ResolveAsset } from '../host/commands'
import type { RevealBinding } from '../components/StoryLog'
import type { AwaitKind } from '../components/RevealingLine'

export interface Playback {
  state: PlayState
  /** 本次推进新触发的一次性音效（瞬时）。 */
  sfx: string[]
  /** 传给 Player / StoryLog 的打字机揭示绑定。 */
  reveal: RevealBinding
  /** 选择第 pos 个可见选项。 */
  onChoose: (pos: number) => void
  /** 提交 @input 输入框文本。 */
  onSubmitInput: (text: string) => void
  /** 点击正文区：打字中 → 立即整行显示；已显示完且逐行模式 → 进下一行。 */
  onContentClick: () => void
}

/** 是否已抵暂停点（结束 / 有选项 / 有输入框 / 出错）——输入框与选项都是「等读者」的硬停顿。 */
function atPause(s: PlayState): boolean {
  return s.ended || s.choices.length > 0 || s.input !== null || s.error != null
}

/**
 * 前向播放驱动壳：持有可变 Story，用 `step` 逐行推进 + 打字机揭示 + stepMode 分派。
 * - flow 模式：一行打完自动 step 到下一行 / 暂停点。
 * - line 模式：一行打完等读者点击再 step。
 * - 打字中点击 → 立即整行显示（跳过打字）。
 * 抵选项 / 结束即停，交由 Player 的 Choices / 结束渲染。viewer / reader 消费。
 */
export function usePlayback(story: Story, resolve: ResolveAsset, initial: PlayState = initialState): Playback {
  const [state, setState] = useState<PlayState>(initial)
  const [sfx, setSfx] = useState<string[]>([])
  const [skipToken, setSkipToken] = useState(0)
  // line 模式：最新行已显示完、等读者点击出下一行（Player 据此亮推进提示三角）。
  const [awaitingClick, setAwaitingClick] = useState(false)

  const storyRef = useRef<Story>(story)
  const stateRef = useRef<PlayState>(initial)
  const revealingRef = useRef(false)
  // 最新一行正停在句中 `<pause>` 标记处的档位（RevealingLine 上报）。点击门控必须看它——
  // 读档续读时 step 直接落回存档的暂停点，`revealingRef` 为 false，但那一行仍在分段揭示。
  const awaitingPauseRef = useRef<AwaitKind>(null)
  const lastStoryRef = useRef<Story | null>(null)
  // @sleep 演出停顿：未决定时器 + 「正在等」标记（等待期间点击一律忽略——停顿是作者钦定的，不可跳过）
  // + 到点时刻（StrictMode 模拟卸载后按剩余时长重挂，见下方 reset effect）。
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waitingSleepRef = useRef(false)
  const sleepDeadlineRef = useRef<number | null>(null)
  // doStep 放 ref 供停顿到点时回调（commit 早于 doStep 定义，直接引用会成环）。
  const doStepRef = useRef<() => void>(() => {})

  /** 只清定时器句柄，**保留**等待意图与到点时刻（供重挂）。 */
  const clearSleepTimer = useCallback(() => {
    if (sleepTimerRef.current !== null) {
      clearTimeout(sleepTimerRef.current)
      sleepTimerRef.current = null
    }
  }, [])
  /** 彻底取消停顿：句柄 + 等待意图一起清（换档 / 新状态落下时用）。 */
  const cancelSleep = useCallback(() => {
    clearSleepTimer()
    waitingSleepRef.current = false
    sleepDeadlineRef.current = null
  }, [clearSleepTimer])
  /** 挂一个 ms 后续步的定时器（不碰等待意图，供首次 arm 与重挂共用）。 */
  const scheduleSleep = useCallback((ms: number) => {
    sleepTimerRef.current = setTimeout(() => {
      sleepTimerRef.current = null
      waitingSleepRef.current = false
      sleepDeadlineRef.current = null
      doStepRef.current()
    }, ms)
  }, [])
  // initial 随 story 换档而变（读档从存档态续）；放 ref，reset effect 只依赖 story。
  const initialRef = useRef(initial)
  initialRef.current = initial

  const commit = useCallback((next: PlayState, nextSfx: string[], pendingSleep?: number) => {
    stateRef.current = next
    setState(next)
    setSfx(nextSfx)
    setAwaitingClick(false) // 新状态：要么开始打新行，要么抵暂停点——都不在「等点击」
    cancelSleep() // 任何新状态都作废上一个未决停顿（换档 / 选项推进等）
    if (pendingSleep !== undefined) {
      // 撞上 @sleep：既不是在揭示、也不是在等读者——等满时长自动续步。
      revealingRef.current = false
      waitingSleepRef.current = true
      sleepDeadlineRef.current = Date.now() + pendingSleep
      scheduleSleep(pendingSleep)
      return
    }
    // 产出了新一行（未抵暂停点）→ 该行正在打字揭示。
    revealingRef.current = !atPause(next)
  }, [cancelSleep, scheduleSleep])

  const doStep = useCallback(() => {
    const r = step(storyRef.current, stateRef.current, resolve)
    commit(r.state, r.sfx, r.pendingSleep)
  }, [resolve, commit])
  doStepRef.current = doStep

  // Story 首次 / 换档（读者读档）→ 重置到该 story 的 initial 并 step。ref 守卫兼挡 StrictMode 双调用。
  // 新故事 initial=initialState（step 首帧、逐字揭示开场）；读档 initial=存档态（已在暂停点、log 完整，step 落回同一暂停点）。
  useEffect(() => {
    if (lastStoryRef.current === story) {
      // 同一 story 重跑 effect（StrictMode 双跑）：上一轮 cleanup 只清了定时器句柄，等待意图还在
      // ——按剩余时长重挂，否则「开场即 @sleep」的故事在 dev 下会永久卡住（flow 模式点也点不动）。
      if (waitingSleepRef.current && sleepTimerRef.current === null && sleepDeadlineRef.current !== null) {
        scheduleSleep(Math.max(0, sleepDeadlineRef.current - Date.now()))
      }
      return
    }
    lastStoryRef.current = story
    storyRef.current = story
    const init = initialRef.current
    stateRef.current = init
    setState(init)
    setSfx([])
    setSkipToken(0)
    setAwaitingClick(false)
    revealingRef.current = false
    cancelSleep() // 旧故事的未决停顿不得把旧行续到新故事上
    doStep()
  }, [story, doStep, cancelSleep, scheduleSleep])

  // 卸载：只清定时器句柄（回调不该打到已卸载组件上），**保留**等待意图——
  // StrictMode 的「模拟卸载」也走这里，上面的 reset effect 会按剩余时长重挂。
  // 不变量：本 effect 的 cleanup 一旦触发，上面那个 reset effect **必定**随之重跑
  //（现在成立：依赖是 useCallback([]) 的稳定引用，只有真卸载 / StrictMode 双跑 / HMR 会 cleanup，
  // 而那三种场合 reset effect 都会重跑）。若将来给本 effect 加了会单独变化的依赖，
  // 就会退化成「清了不重挂」的死锁——届时改回在 cleanup 里 cancelSleep 或另找重挂时机。
  useEffect(() => clearSleepTimer, [clearSleepTimer])

  // 最新一行揭示完成：flow → 自动续；line → 等点击（亮推进提示）。
  const onLatestRevealed = useCallback(() => {
    revealingRef.current = false
    const cur = stateRef.current
    if (cur.host.stepMode === 'flow') {
      doStep()
      return
    }
    if (!atPause(cur)) setAwaitingClick(true)
  }, [doStep])

  const onChoose = useCallback(
    (pos: number) => {
      const cur = stateRef.current
      const view = cur.choices[pos]
      if (view == null) return
      // Q7 看门狗：ChoiceView.index 恒等于其在 choices 里的位置（engine 的 currentChoices 不过滤/重排）。
      // onChoose、Player 选项渲染、reader/viewer 的位置回传三处都隐式假定 pos===index；若将来
      // engine 引入条件过滤使二者背离，这里立刻炸响，而非静默把「点第 pos 个」错映到别的分支。
      if (view.index !== pos) {
        throw new Error(`ChoiceView.index(${view.index}) 与显示位置(${pos})不一致：播放层多处假定二者相等`)
      }
      const r = chooseStep(storyRef.current, cur, view.index, resolve)
      commit(r.state, r.sfx, r.pendingSleep)
    },
    [resolve, commit],
  )

  const onSubmitInput = useCallback(
    (text: string) => {
      const cur = stateRef.current
      if (cur.input == null) return
      const r = submitInputStep(storyRef.current, cur, text, resolve)
      commit(r.state, r.sfx, r.pendingSleep)
    },
    [resolve, commit],
  )

  const onContentClick = useCallback(() => {
    // @sleep 是作者钦定的演出停顿：等待期间点击**完全无效**——既不提前续行，
    // 也不能落到下面 line 模式的 doStep 分支（那会把停顿一键跳过）。
    if (waitingSleepRef.current) return
    // 毫秒档 `<pause=毫秒>` 等待中：与 @sleep 同理，点击完全无效——**必须在此拦下**，
    // 否则会掉进下面 line 模式的 doStep 分支，把整行连同停顿一键跳过。
    if (awaitingPauseRef.current === 'timed') return
    // 打字中 → 当前段立显；停在句中点击档 `<pause>` → 续下一段。两者都由 skipToken 递增驱动，
    // 由 RevealingLine 分档处置。`awaitingPauseRef` 不能省：读档续读时该行仍在分段揭示，
    // 但 `revealingRef` 已因「已抵暂停点」为 false，只看它会让后半句永远出不来。
    if (revealingRef.current || awaitingPauseRef.current) {
      setSkipToken((t) => t + 1)
      return
    }
    const cur = stateRef.current
    if (!atPause(cur) && cur.host.stepMode === 'line') doStep() // 已显示完、逐行模式 → 下一行
  }, [doStep])

  // 句中点击档 `<pause>` 停在标记处 = 另一种「等你点击」——与 line 模式整行完等点击共用推进提示三角。
  // 毫秒档只参与点击门控、**不亮三角**（没在等读者，与 @sleep 等待期间一致）。
  // 段间等待是 RevealingLine 的内部态，这里只把它并进 awaitingClick 做呈现 + 参与点击门控。
  const onAwaitingPause = useCallback((waiting: AwaitKind) => {
    awaitingPauseRef.current = waiting
    setAwaitingClick(waiting === 'click')
  }, [])

  const reveal: RevealBinding = {
    speed: state.host.textSpeed,
    fade: state.host.textFade,
    skipToken,
    onLatestRevealed,
    onAwaitingPause,
    awaitingClick,
  }

  return { state, sfx, reveal, onChoose, onSubmitInput, onContentClick }
}
