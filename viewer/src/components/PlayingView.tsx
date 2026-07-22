import { useEffect, useRef } from 'react'
import type { Story } from '@kiny/engine'
import { Player, usePlayback, type ResolveAsset, type PlayState, type InteractionStep } from '@kiny/player'
import { saveProgress } from '../load/progress'

/**
 * 驱动壳：usePlayback 持有 Story，逐行 step 推进 + 打字机揭示 + stepMode 分派。
 * 首帧推进与 StrictMode 双调用由 usePlayback 内部守卫处理。
 *
 * 可选阅读进度持久化（reader-design X5）：传 progressKey + seed 时，每次读者 choose / submitInput
 * 追加一步交互序列并落 localStorage；`initialState` 从上次暂停点续（usePlayback 第三参）。
 * 缺这些 props 时退化为纯播放（如单元测试 / 无持久化场景），不改行为。
 */
export function PlayingView({
  story, resolveAsset, initialState, initialSeq, progressKey, seed, onRestart,
}: {
  story: Story
  resolveAsset: ResolveAsset
  initialState?: PlayState
  initialSeq?: InteractionStep[]
  progressKey?: string
  seed?: number
  onRestart?: () => void
}) {
  const pb = usePlayback(story, resolveAsset, initialState)
  const seqRef = useRef<InteractionStep[]>(initialSeq ? [...initialSeq] : [])
  // 换 story（「重新开始」/ 恢复另一局，App 每次都 createStory 出新实例）→ 重置交互序列到该局的
  // initialSeq。PlayingView 无 key、不重挂载，故 seqRef 不会自动重置——否则重开后首次交互会把新
  // seed 与旧序列一起落盘、刷新恢复到错位置（镜像 usePlayback 的 story-keyed reset）。
  useEffect(() => {
    seqRef.current = initialSeq ? [...initialSeq] : []
    // eslint-disable-next-line react-hooks/exhaustive-deps —— 只在 story 换局时重置，initialSeq 取当帧值。
  }, [story])

  const record = (s: InteractionStep) => {
    if (progressKey === undefined || seed === undefined) return
    seqRef.current = [...seqRef.current, s]
    saveProgress(progressKey, seed, seqRef.current)
  }
  const onChoose = (pos: number) => {
    if (pb.state.choices[pos] === undefined) return // 无效选项不记（防污染回放序列）
    record({ kind: 'choice', pos })
    pb.onChoose(pos)
  }
  const onSubmitInput = (text: string) => {
    if (pb.state.input === null) return
    record({ kind: 'input', text })
    pb.onSubmitInput(text)
  }

  return (
    <>
      <Player
        state={pb.state} sfx={pb.sfx} reveal={pb.reveal}
        onChoose={onChoose} onSubmitInput={onSubmitInput} onContentClick={pb.onContentClick}
      />
      {onRestart && (
        <button type="button" className="restart-btn" onClick={onRestart}>重新开始</button>
      )}
    </>
  )
}
