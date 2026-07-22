import { useEffect, useRef, type CSSProperties } from 'react'
import { Player, type PlayState, type RevealBinding } from '@kiny/player'

/**
 * 预览区：受控驱动 <Player>。
 * - stale：program 当前无效，画面冻结在上一帧，显示角标（spec §5.2）。
 * - play.error：编辑器侧的运行时错误横幅（停在出错点，不崩）。spec §6。
 *   错误原始 message 由 <Player> 自身渲染（单一真相源），此处只标「运行时错误」+ 定位。
 * onChoose(pos) / onSubmitInput(text) 上抛给预览控制器（把对应交互步追加进交互序列重算）。
 */
export function PreviewPane({
  play,
  stale,
  sfx,
  seed,
  onChoose,
  onSubmitInput,
  onRestart,
  onBack,
  canGoBack,
  reveal,
  onContentClick,
  style,
}: {
  play: PlayState | null
  stale: boolean
  sfx?: string[]
  seed: number
  onChoose: (pos: number) => void
  onSubmitInput: (text: string) => void
  onRestart: () => void
  /** 返回上一步（撤销上一次 choice/@input，回到上一决定点重放）；canGoBack 为假时按钮禁用。作者调试工具。 */
  onBack: () => void
  canGoBack: boolean
  /** 打字机揭示绑定；只有人工点选项/重开预览时有值(usePreviewPlayback)，编辑重算/AI 校验时为 undefined。 */
  reveal?: RevealBinding
  onContentClick?: () => void
  /** 作为 workbench grid 子项时的外部样式（如显式 grid-column 定位）。 */
  style?: CSSProperties
}) {
  // 叙事增长时把阅读区滚到底（用 scrollTop，绝不用 scrollIntoView——会搞坏容器滚动）。
  const stageRef = useRef<HTMLDivElement>(null)
  const logLen = play?.log.length ?? 0
  useEffect(() => {
    const el = stageRef.current?.querySelector<HTMLElement>('.player-content') ?? stageRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLen])

  return (
    <div className="preview-pane" data-testid="preview" style={style}>
      <div className="preview-bar">
        <span className="preview-label">预览</span>
        {stale && <span className="preview-stale">基于上一个有效版本</span>}
        <span className="preview-spacer" />
        <span className="preview-seed">种子 #{seed.toString(16)}</span>
        <button className="preview-back" onClick={onBack} disabled={!canGoBack} title="撤销上一次选择 / 输入，回到上一步">
          ← 上一步
        </button>
        <button className="preview-restart" onClick={onRestart}>
          ↺ 重开预览
        </button>
      </div>
      {play === null ? (
        <div className="preview-empty">暂无预览（先写出可运行的故事）</div>
      ) : (
        <>
          {play.error && (
            <p className="preview-runtime-error">
              运行时错误 {play.error.file ?? ''}
              {play.error.line != null ? `:${play.error.line}` : ''}
            </p>
          )}
          <div className="preview-stage" ref={stageRef}>
            <Player state={play} sfx={sfx} onChoose={onChoose} onSubmitInput={onSubmitInput} reveal={reveal} onContentClick={onContentClick} />
          </div>
        </>
      )}
    </div>
  )
}
