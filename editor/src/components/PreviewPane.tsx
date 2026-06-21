import { useEffect, useRef } from 'react'
import { Player, type PlayState } from '@kiny/player'

/**
 * 预览区：受控驱动 <Player>。
 * - stale：program 当前无效，画面冻结在上一帧，显示角标（spec §5.2）。
 * - play.error：编辑器侧的运行时错误横幅（停在出错点，不崩）。spec §6。
 *   错误原始 message 由 <Player> 自身渲染（单一真相源），此处只标「运行时错误」+ 定位。
 * onChoose(pos) 上抛给预览控制器（把 pos 追加进 choiceSeq 重算）。
 */
export function PreviewPane({
  play,
  stale,
  sfx,
  onChoose,
  onRestart,
}: {
  play: PlayState | null
  stale: boolean
  sfx?: string[]
  onChoose: (pos: number) => void
  onRestart: () => void
}) {
  // 叙事增长时把阅读区滚到底（用 scrollTop，绝不用 scrollIntoView——会搞坏容器滚动）。
  const stageRef = useRef<HTMLDivElement>(null)
  const logLen = play?.log.length ?? 0
  useEffect(() => {
    const el = stageRef.current?.querySelector<HTMLElement>('.player-content') ?? stageRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLen])

  return (
    <div className="preview-pane" data-testid="preview">
      <div className="preview-bar">
        <span className="preview-label">预览</span>
        {stale && <span className="preview-stale">基于上一个有效版本</span>}
        <span className="preview-spacer" />
        <span className="preview-seed">种子 #5eed</span>
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
            <Player state={play} sfx={sfx} onChoose={onChoose} />
          </div>
        </>
      )}
    </div>
  )
}
