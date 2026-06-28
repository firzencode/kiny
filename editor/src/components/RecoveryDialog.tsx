import type { RecoverableItem } from '../state/drafts'

export interface RecoveryDialogProps {
  /** 受影响的草稿项；空 / null = 不渲染。 */
  items: RecoverableItem[] | null
  onRecover: () => void  // 把可恢复草稿载回缓冲（标脏）
  onDiscard: () => void  // 删除这些草稿、按磁盘文件打开
}

const STATUS_NOTE: Record<RecoverableItem['status'], string> = {
  ok: '',
  diskChanged: '（磁盘文件已变化）',
  missing: '（文件已删除或改名，将跳过）',
}

/**
 * 崩溃恢复提示（spec §5）：列出「草稿内容 ≠ 磁盘文件」的项，强制二选——
 * 恢复（载回缓冲并标脏，回到正常保存/丢弃流程）或丢弃（删草稿、按磁盘打开）。
 * 不提供 Esc / 点遮罩这类暧昧消解：删草稿是不可逆的数据丢失动作，必须用户显式抉择，
 * 避免一次误触把崩溃后唯一能恢复的未保存内容删光。仅在重开项目检测到残留草稿时弹出。
 */
export function RecoveryDialog({ items, onRecover, onDiscard }: RecoveryDialogProps) {
  if (!items || items.length === 0) return null
  const recoverable = items.filter((i) => i.status !== 'missing').length

  return (
    <div className="confirm-scrim">
      <div className="confirm-dlg recovery-dlg" role="dialog" aria-modal="true" aria-label="恢复未保存的改动">
        <h2 className="confirm-title">恢复未保存的改动</h2>
        <p className="confirm-body">上次未正常退出，检测到以下文件有未保存的草稿：</p>
        <ul className="recovery-list">
          {items.map((i) => (
            <li key={i.path} className={'recovery-item' + (i.status === 'missing' ? ' missing' : '')}>
              <span className="recovery-path">{i.path}</span>
              {STATUS_NOTE[i.status] && <span className="recovery-note">{STATUS_NOTE[i.status]}</span>}
            </li>
          ))}
        </ul>
        <div className="confirm-actions">
          <button className="confirm-btn primary" autoFocus disabled={recoverable === 0} onClick={onRecover}>恢复</button>
          <button className="confirm-btn" onClick={onDiscard}>丢弃</button>
        </div>
      </div>
    </div>
  )
}
