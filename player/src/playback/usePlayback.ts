import { useCallback, useEffect, useRef, useState } from 'react'
import type { Story } from '@kiny/engine'
import { initialState, step, chooseStep, submitInputStep, type PlayState } from '../driver/storyDriver'
import type { ResolveAsset } from '../host/commands'
import type { RevealBinding } from '../components/StoryLog'

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
 * 抵选项 / 结束即停，交由 Player 的 Choices / 结束渲染。web-reader / reader 消费。
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
  const lastStoryRef = useRef<Story | null>(null)
  // initial 随 story 换档而变（读档从存档态续）；放 ref，reset effect 只依赖 story。
  const initialRef = useRef(initial)
  initialRef.current = initial

  const commit = useCallback((next: PlayState, nextSfx: string[]) => {
    stateRef.current = next
    setState(next)
    setSfx(nextSfx)
    setAwaitingClick(false) // 新状态：要么开始打新行，要么抵暂停点——都不在「等点击」
    // 产出了新一行（未抵暂停点）→ 该行正在打字揭示。
    revealingRef.current = !atPause(next)
  }, [])

  const doStep = useCallback(() => {
    const r = step(storyRef.current, stateRef.current, resolve)
    commit(r.state, r.sfx)
  }, [resolve, commit])

  // Story 首次 / 换档（读者读档）→ 重置到该 story 的 initial 并 step。ref 守卫兼挡 StrictMode 双调用。
  // 新故事 initial=initialState（step 首帧、逐字揭示开场）；读档 initial=存档态（已在暂停点、log 完整，step 落回同一暂停点）。
  useEffect(() => {
    if (lastStoryRef.current === story) return
    lastStoryRef.current = story
    storyRef.current = story
    const init = initialRef.current
    stateRef.current = init
    setState(init)
    setSfx([])
    setSkipToken(0)
    setAwaitingClick(false)
    revealingRef.current = false
    doStep()
  }, [story, doStep])

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
      // onChoose、Player 选项渲染、reader/web-reader 的位置回传三处都隐式假定 pos===index；若将来
      // engine 引入条件过滤使二者背离，这里立刻炸响，而非静默把「点第 pos 个」错映到别的分支。
      if (view.index !== pos) {
        throw new Error(`ChoiceView.index(${view.index}) 与显示位置(${pos})不一致：播放层多处假定二者相等`)
      }
      const r = chooseStep(storyRef.current, cur, view.index, resolve)
      commit(r.state, r.sfx)
    },
    [resolve, commit],
  )

  const onSubmitInput = useCallback(
    (text: string) => {
      const cur = stateRef.current
      if (cur.input == null) return
      const r = submitInputStep(storyRef.current, cur, text, resolve)
      commit(r.state, r.sfx)
    },
    [resolve, commit],
  )

  const onContentClick = useCallback(() => {
    if (revealingRef.current) {
      setSkipToken((t) => t + 1) // 打字中 → 跳过，整行立显
      return
    }
    const cur = stateRef.current
    if (!atPause(cur) && cur.host.stepMode === 'line') doStep() // 已显示完、逐行模式 → 下一行
  }, [doStep])

  const reveal: RevealBinding = {
    speed: state.host.textSpeed,
    fade: state.host.textFade,
    skipToken,
    onLatestRevealed,
    awaitingClick,
  }

  return { state, sfx, reveal, onChoose, onSubmitInput, onContentClick }
}
