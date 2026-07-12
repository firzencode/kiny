import { useCallback, useRef, useState } from 'react'
import { createStory } from '@kiny/engine'
import type { ValidatedProgram, Story } from '@kiny/engine'
import {
  initialState, step, chooseStep, submitInputStep, replayToStory,
  type PlayState, type ResolveAsset, type RevealBinding, type InteractionStep,
} from '@kiny/player'

/**
 * editor 预览面板专属的打字机播放层：只在人工点选项 / 提交输入 / 点重开预览时启动一次动画。
 * 编辑重算（App 的 onValidated/recompute）与 AI 的 PreviewPort 都不经过这里
 * （spec docs/superpowers/specs/2026-07-08-prose-step-advance-typewriter-design.md
 * 「editor 预览接线的精确规则」）。每一步的中间 PlayState 都经 onCommit 写回调用方
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

export function usePreviewPlayback(onCommit: (state: PlayState, sfx: string[]) => void): PreviewPlayback {
  const [active, setActive] = useState(false)
  const [skipToken, setSkipToken] = useState(0)
  // line 模式：最新行已显示完、等点击出下一行（Player 据此亮推进提示三角）。
  const [awaitingClick, setAwaitingClick] = useState(false)
  const storyRef = useRef<Story | null>(null)
  const resolveRef = useRef<ResolveAsset>((n) => n)
  const lastStateRef = useRef<PlayState>(initialState)
  const revealingRef = useRef(false)
  // 代龄计数：当前所有 commit 都同步发起，故下面 commit 里的 gen 校验实际不会命中——
  // cancel 的真正生效靠 storyRef=null（令在飞 timer 回调的 doStep 早退）+ setActive(false)。
  // genRef 是为「将来若改成异步调度 commit」留的防线；届时 storyRef=null 不再足够，代龄校验才兜底。
  const genRef = useRef(0)

  const cancel = useCallback(() => {
    genRef.current++
    storyRef.current = null
    revealingRef.current = false
    setActive(false)
    setAwaitingClick(false)
  }, [])

  const commit = useCallback((gen: number, state: PlayState, sfx: string[]) => {
    if (gen !== genRef.current) return // 已被 cancel / 新一轮 restart-choose 取代
    lastStateRef.current = state
    onCommit(state, sfx)
    setAwaitingClick(false) // 新状态：要么开始打新行，要么抵暂停点——都不在「等点击」
    revealingRef.current = !(state.ended || state.choices.length > 0 || state.input !== null || state.error != null)
    if (!revealingRef.current) setActive(false) // 抵暂停点（含 @input 输入框）：动画收尾
  }, [onCommit])

  const doStep = useCallback(() => {
    const gen = genRef.current
    const story = storyRef.current
    if (story == null) return
    const r = step(story, lastStateRef.current, resolveRef.current)
    commit(gen, r.state, r.sfx)
  }, [commit])

  const run = useCallback((story: Story, resolve: ResolveAsset, first: { state: PlayState; sfx: string[] }) => {
    genRef.current++
    const gen = genRef.current
    storyRef.current = story
    resolveRef.current = resolve
    revealingRef.current = false
    setActive(true)
    commit(gen, first.state, first.sfx)
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
    if (cur.host.stepMode === 'flow') {
      doStep()
      return
    }
    const atPause = cur.ended || cur.choices.length > 0 || cur.input !== null || cur.error != null
    if (!atPause) setAwaitingClick(true) // line 模式：等点击出下一行 → 亮推进提示
  }, [doStep])

  const onContentClick = useCallback(() => {
    if (revealingRef.current) { setSkipToken((t) => t + 1); return } // 打字中点击 → 跳过
    const cur = lastStateRef.current
    const atPause = cur.ended || cur.choices.length > 0 || cur.input !== null || cur.error != null
    if (!atPause && cur.host.stepMode === 'line') doStep() // 已显示完、逐行模式 → 下一行
  }, [doStep])

  const reveal: RevealBinding | undefined = active
    ? { speed: lastStateRef.current.host.textSpeed, fade: lastStateRef.current.host.textFade, skipToken, onLatestRevealed, awaitingClick }
    : undefined

  return { active, reveal, onContentClick: active ? onContentClick : undefined, restart, choose, submit, cancel }
}
