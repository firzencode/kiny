import { useState } from 'react'
import type { PlayState } from '../driver/storyDriver'
import { BackgroundLayer } from './BackgroundLayer'
import { StoryLog, type RevealBinding } from './StoryLog'
import { Choices } from './Choices'
import { InputBox } from './InputBox'
import { AudioController } from './AudioController'
import { AudioToggle } from './AudioToggle'
import { SfxController } from './SfxController'

/**
 * 受控播放视口：只收 state + onChoose(pos)，自身不驱动 Story。
 * 驱动逻辑（advance/choose/replay/usePlayback）由消费者持有（web-reader/reader 用 usePlayback，editor 用保位重算）。
 * onChoose 的入参是「第几个可见选项」(0-based 位置)；因 ChoiceView.index === 位置，二者等价。
 * sfx：本次推进新触发的一次性音效队列（瞬时，引用变化即播）；与 bgm 共用 muted。
 * reveal / onContentClick（可选）：接 usePlayback 时启用打字机逐字揭示 + 点击推进 / 跳过；不传则最新行静态呈现。
 */
export function Player({
  state, onChoose, sfx = [], reveal, onContentClick, onSubmitInput,
}: {
  state: PlayState
  onChoose: (pos: number) => void
  sfx?: string[]
  reveal?: RevealBinding
  onContentClick?: () => void
  /** 提交 @input 输入框文本；缺省时输入框以禁用态渲染（如 editor 预览）。 */
  onSubmitInput?: (text: string) => void
}) {
  const [muted, setMuted] = useState(false)
  return (
    <div className="player">
      <BackgroundLayer src={state.host.bg} />
      <AudioController bgm={state.host.bgm} muted={muted} />
      <SfxController sfx={sfx} muted={muted} />
      <AudioToggle muted={muted} onToggle={() => setMuted((m) => !m)} />
      <div
        className="player-content"
        onClick={onContentClick ? () => onContentClick() : undefined}
      >
        <StoryLog entries={state.log} reveal={reveal} />
        {reveal?.awaitingClick && <div className="advance-indicator" aria-hidden="true" />}
        {state.error && (
          <p className="player-error">
            运行期错误 {state.error.file ?? ''}{state.error.line != null ? `:${state.error.line}` : ''} {state.error.message}
          </p>
        )}
        {!state.ended && !state.error && (
          state.input !== null
            ? <InputBox placeholder={state.input.placeholder} onSubmit={onSubmitInput} />
            : <Choices items={state.choices} onChoose={onChoose} />
        )}
      </div>
    </div>
  )
}
