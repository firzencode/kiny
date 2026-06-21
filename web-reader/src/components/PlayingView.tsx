import { useState } from 'react'
import type { Story } from '@kiny/engine'
import { Player, choose, type PlayState, type ResolveAsset } from '@kiny/player'

/**
 * 驱动壳：持有 PlayState，把玩家点选（位置）经 choose 推进 Story 后 setState。
 * choose 是有状态操作，故在事件处理器里先算 next 再 setState（不放进更新器），
 * 规避 React StrictMode 更新器双调用把 Story 推进两次。
 */
export function PlayingView({
  story, resolveAsset, first,
}: {
  story: Story
  resolveAsset: ResolveAsset
  first: PlayState
}) {
  const [state, setState] = useState<PlayState>(first)
  const [sfx, setSfx] = useState<string[]>([])
  const onChoose = (pos: number) => {
    const r = choose(story, state, state.choices[pos].index, resolveAsset)
    setState(r.state)
    setSfx(r.sfx) // 本步触发的一次性音效 → Player 播放（瞬时，新引用即播）
  }
  return <Player state={state} sfx={sfx} onChoose={onChoose} />
}
