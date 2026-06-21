import { useState } from 'react'
import type { PlayState } from '../driver/storyDriver'
import { BackgroundLayer } from './BackgroundLayer'
import { StoryLog } from './StoryLog'
import { Choices } from './Choices'
import { AudioController } from './AudioController'
import { AudioToggle } from './AudioToggle'
import { SfxController } from './SfxController'

/**
 * 受控播放视口：只收 state + onChoose(pos)，自身不驱动 Story。
 * 驱动逻辑（advance/choose/replay）由消费者持有（web-reader 的 PlayingView、editor 的预览控制器）。
 * onChoose 的入参是「第几个可见选项」(0-based 位置)；因 ChoiceView.index === 位置，二者等价。
 * sfx：本次推进新触发的一次性音效队列（瞬时，引用变化即播）；与 bgm 共用 muted。
 */
export function Player({
  state, onChoose, sfx = [],
}: {
  state: PlayState
  onChoose: (pos: number) => void
  sfx?: string[]
}) {
  const [muted, setMuted] = useState(false)
  return (
    <div className="player">
      <BackgroundLayer src={state.host.bg} />
      <AudioController bgm={state.host.bgm} muted={muted} />
      <SfxController sfx={sfx} muted={muted} />
      <AudioToggle muted={muted} onToggle={() => setMuted((m) => !m)} />
      <div className="player-content">
        <StoryLog entries={state.log} />
        {state.error && (
          <p className="player-error">
            运行期错误 {state.error.file ?? ''}{state.error.line != null ? `:${state.error.line}` : ''} {state.error.message}
          </p>
        )}
        {!state.ended && !state.error && (
          <Choices items={state.choices} onChoose={onChoose} />
        )}
      </div>
    </div>
  )
}
