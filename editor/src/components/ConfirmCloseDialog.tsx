import { useEffect } from 'react'

export type CloseIntent =
  | { kind: 'tab'; path: string } // 关某个 tab（可能非活动）
  | { kind: 'exit' }              // 退出整个 editor

export interface ConfirmCloseDialogProps {
  intent: CloseIntent | null // null = 不渲染
  dirtyCount: number         // 退出场景显示"N 个文件未保存"
  onSave: () => void         // tab→保存 / exit→全部保存
  onDiscard: () => void      // tab→不保存 / exit→不保存并退出
  onCancel: () => void
}

/** 关闭未保存内容时的三选确认框。参照 HelpDialog：Esc / 点背景 = 取消。 */
export function ConfirmCloseDialog({ intent, dirtyCount, onSave, onDiscard, onCancel }: ConfirmCloseDialogProps) {
  useEffect(() => {
    if (!intent) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [intent, onCancel])

  if (!intent) return null

  const isTab = intent.kind === 'tab'
  const title = isTab ? '关闭未保存的文件' : '退出 Kiny Editor'
  const body = isTab
    ? `「${intent.path}」有未保存的改动。是否保存后再关闭？`
    : `有 ${dirtyCount} 个文件未保存，退出前是否保存？`
  const saveLabel = isTab ? '保存' : '全部保存'
  const discardLabel = isTab ? '不保存' : '不保存并退出'

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
        <p className="confirm-body">{body}</p>
        <div className="confirm-actions">
          <button className="confirm-btn primary" autoFocus onClick={onSave}>{saveLabel}</button>
          <button className="confirm-btn" onClick={onDiscard}>{discardLabel}</button>
          <button className="confirm-btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}
