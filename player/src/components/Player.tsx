import { useMemo, useState } from 'react'
import type { PlayState } from '../driver/storyDriver'
import { applyCharactersToView } from '../characters/view'
import type { CharacterTable } from '../characters/table'
import { BackgroundLayer } from './BackgroundLayer'
import { StoryLog, type RevealBinding } from './StoryLog'
import { Choices } from './Choices'
import { InputBox } from './InputBox'
import { AudioController } from './AudioController'
import { AudioToggle } from './AudioToggle'
import { SfxController } from './SfxController'
import { FixedPanels, AfterPanel } from './Panels'

// 模块级稳定空数组：不传 sfx 时的默认值。用 `sfx = []` 默认参会每次渲染新建数组，
// 令下游 SfxController 的「引用变化即播」误判为有新音效（Q3）。
const NO_SFX: string[] = []
/** 同理的模块级稳定空表：不传 characters 时的默认值（默认参每次渲染新建对象，会废掉 useMemo）。 */
const NO_CHARACTERS: CharacterTable = new Map()

/**
 * 受控播放视口：只收 state + onChoose(pos)，自身不驱动 Story。
 * 驱动逻辑（advance/choose/replay/usePlayback）由消费者持有（viewer/reader 用 usePlayback，editor 用保位重算）。
 * onChoose 的入参是「第几个可见选项」(0-based 位置)；因 ChoiceView.index === 位置，二者等价。
 * sfx：本次推进新触发的一次性音效队列（瞬时，引用变化即播）；与 bgm 共用 muted。
 * reveal / onContentClick（可选）：接 usePlayback 时启用打字机逐字揭示 + 点击推进 / 跳过；不传则最新行静态呈现。
 */
export function Player({
  state, onChoose, sfx = NO_SFX, reveal, onContentClick, onSubmitInput,
  characters = NO_CHARACTERS,
}: {
  state: PlayState
  onChoose: (pos: number) => void
  sfx?: string[]
  reveal?: RevealBinding
  onContentClick?: () => void
  /** 提交 @input 输入框文本；缺省时输入框以禁用态渲染（如 editor 预览）。 */
  onSubmitInput?: (text: string) => void
  /** 作品角色表（宿主解析 `characters.json` 后传入）：渲染前给三处 spans 按说话人着色。 */
  characters?: CharacterTable
}) {
  const [muted, setMuted] = useState(false)
  // 着色收在渲染入口做一次：下游组件一行不改，且**揭示中的最新一行**（走 RevealingLine、
  // 绕开 RichText）同样吃到着色。无角色声明时返回同一批引用，不触发多余重渲染。
  const view = useMemo(() => applyCharactersToView(state, characters), [state, characters])
  return (
    <div className="player">
      <BackgroundLayer src={state.host.bg} />
      <AudioController bgm={state.host.bgm} muted={muted} />
      <SfxController sfx={sfx} muted={muted} />
      <AudioToggle muted={muted} onToggle={() => setMuted((m) => !m)} />
      <FixedPanels panels={view.panels} />
      <div
        className="player-content"
        onClick={onContentClick ? () => onContentClick() : undefined}
      >
        <StoryLog entries={view.log} reveal={reveal} />
        {reveal?.awaitingClick && <div className="advance-indicator" aria-hidden="true" />}
        {state.error && (
          <p className="player-error">
            运行期错误 {state.error.file ?? ''}{state.error.line != null ? `:${state.error.line}` : ''} {state.error.message}
          </p>
        )}
        {/* 正文后固定栏：排在选项 / 输入框之前、随正文流滚动。 */}
        <AfterPanel panels={view.panels} />
        {!state.ended && !state.error && (
          state.input !== null
            ? <InputBox placeholder={state.input.placeholder} onSubmit={onSubmitInput} />
            : <Choices items={view.choices} onChoose={onChoose} />
        )}
      </div>
    </div>
  )
}
