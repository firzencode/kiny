import { useState } from 'react'
import type { Story } from '@kiny/engine'
import { Player, choose, type PlayState, type ResolveAsset } from '@kiny/player'

/**
 * 驱动壳（镜像 web-reader PlayingView）：持 PlayState，点选经 choose 推进 Story。
 * choose 有状态，放进事件处理器先算 next 再 setState，规避 StrictMode 更新器双调用。
 * first 由 App 在用户手势内算好传入（不在 render 里 advance）。
 */
export function ReadingView({
  story, resolveAsset, first, title, onBack,
}: {
  story: Story
  resolveAsset: ResolveAsset
  first: PlayState
  title: string
  onBack: () => void
}) {
  const [state, setState] = useState<PlayState>(first)
  const [sfx, setSfx] = useState<string[]>([])
  const onChoose = (pos: number) => {
    const r = choose(story, state, state.choices[pos].index, resolveAsset)
    setState(r.state)
    setSfx(r.sfx) // 本步触发的一次性音效 → Player 播放
  }
  return (
    <div className="reading">
      <div className="reading-bar">
        <button className="back" onClick={onBack}>← 书架</button>
        <span className="title-chip">{title}</span>
      </div>
      <Player state={state} sfx={sfx} onChoose={onChoose} />
    </div>
  )
}
