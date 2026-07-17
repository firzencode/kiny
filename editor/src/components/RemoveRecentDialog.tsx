import { useEffect } from 'react'
import type { RecentProject } from './LaunchScreen'

export interface RemoveRecentDialogProps {
  target: RecentProject | null // null = 不渲染
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 从「最近项目」列表移除某项的两选确认框。
 * 仅移出列表（localStorage 会话记录），不删磁盘文件。参照 ConfirmCloseDialog：Esc / 点背景 = 取消。
 */
export function RemoveRecentDialog({ target, onConfirm, onCancel }: RemoveRecentDialogProps) {
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onCancel])

  if (!target) return null

  const title = '从最近项目中移除'
  return (
    <div className="confirm-scrim" onClick={onCancel}>
      <div
        className="confirm-dlg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-body">
          「{target.name}」将从最近列表移除，磁盘上的项目文件不会被删除。
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn primary" autoFocus onClick={onConfirm}>删除</button>
          <button className="confirm-btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}
