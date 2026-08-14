import { useEffect, useRef, type CSSProperties } from 'react'
import { Player, ProjectStyles, type PlayState, type RevealBinding, type CharacterTable } from '@kiny/player'

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
  fastForward = false,
  onToggleFastForward,
  reveal,
  onContentClick,
  style,
  projectCss = '',
  assetWarnings = [],
  characters,
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
  /**
   * 快进（作者调试工具）：开着时正文瞬显、句中 `<pause>` 与 `@sleep` 不等、逐行模式自动流过、
   * 音效不发——点完一个选项直奔下一个决定点。只作用于预览，不碰作品数据、不影响读者端。
   * 它改变作品表现，故开启态必须一眼可见（工具栏常驻标记 + 按钮高亮）。
   */
  fastForward?: boolean
  onToggleFastForward?: () => void
  /** 打字机揭示绑定；只有人工点选项/重开预览时有值(usePreviewPlayback)，编辑重算/AI 校验时为 undefined。 */
  reveal?: RevealBinding
  onContentClick?: () => void
  /** 作为 workbench grid 子项时的外部样式（如显式 grid-column 定位）。 */
  style?: CSSProperties
  /** 作品主题 css（项目内 css + 字体）；空串 = 不注入（设置里关了「应用作品主题」或项目无资源）。 */
  projectCss?: string
  /** 作品资源问题（非法族名 / 同名冲突 / 读不到）的人话描述；播放端静默跳过，编辑器要提示作者。 */
  assetWarnings?: string[]
  /** 作品角色表（取自 `characters.json` 编辑缓冲）；缺省为无（不着色）。 */
  characters?: CharacterTable
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
      <ProjectStyles css={projectCss} />
      <div className="preview-bar">
        <span className="preview-label">预览</span>
        {fastForward && <span className="preview-fast-mark" role="status">⏩ 快进中</span>}
        {stale && <span className="preview-stale">基于上一个有效版本</span>}
        {assetWarnings.length > 0 && (
          <span className="preview-asset-warn" role="status" title={assetWarnings.join('\n')}>
            ⚠ 资源 {assetWarnings.length} 项问题
          </span>
        )}
        <span className="preview-spacer" />
        <span className="preview-seed">种子 #{seed.toString(16)}</span>
        <button
          className={fastForward ? 'preview-fast on' : 'preview-fast'}
          onClick={onToggleFastForward}
          aria-pressed={fastForward}
          title="快进：正文瞬显、停顿不等、逐行自动流过，直奔下一个决定点（只影响预览）"
        >
          ⏩ 快进
        </button>
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
            <Player state={play} sfx={sfx} onChoose={onChoose} onSubmitInput={onSubmitInput} reveal={reveal} onContentClick={onContentClick} characters={characters} />
          </div>
        </>
      )}
    </div>
  )
}
