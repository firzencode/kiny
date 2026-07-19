import { useEffect, type ReactNode } from 'react'

export type CloseIntent =
  | { kind: 'tab'; path: string }            // 关某个 tab（可能非活动）
  | { kind: 'exit' }                         // 退出整个 editor
  | { kind: 'closeProject' }                 // 关闭当前项目、回到启动页
  | { kind: 'switchProject'; dir: string }   // 切换到另一个项目（就地 loadDir 换项目）

export interface ConfirmCloseDialogProps {
  intent: CloseIntent | null // null = 不渲染
  dirtyCount: number         // 「N 个文件未保存」
  aiRunning: boolean         // AI 是否在跑（跑则离开将中止它）
  onSave: () => void         // tab→保存 / 项目级→保存并离开
  onDiscard: () => void      // tab→不保存 / 项目级→不保存并离开（含仅 AI 在跑时的「中止并离开」）
  onCancel: () => void
}

/** 关闭 / 切换 / 退出前的确认框：脏缓冲与 AI 在跑两个正交条件组合文案。Esc / 点背景 = 取消。 */
export function ConfirmCloseDialog({ intent, dirtyCount, aiRunning, onSave, onDiscard, onCancel }: ConfirmCloseDialogProps) {
  useEffect(() => {
    if (!intent) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [intent, onCancel])

  if (!intent) return null

  // tab 关闭是独立分支（不涉 AI / 项目离开）：沿用原文案。
  if (intent.kind === 'tab') {
    return (
      <Scrim onCancel={onCancel} title="关闭未保存的文件">
        <p className="confirm-body">「{intent.path}」有未保存的改动。是否保存后再关闭？</p>
        <div className="confirm-actions">
          <button className="confirm-btn primary" autoFocus onClick={onSave}>保存</button>
          <button className="confirm-btn" onClick={onDiscard}>不保存</button>
          <button className="confirm-btn" onClick={onCancel}>取消</button>
        </div>
      </Scrim>
    )
  }

  // 项目级动作（切换 / 关闭 / 退出）：动作词 + 脏/AI 组合。
  const action = intent.kind === 'switchProject' ? '切换' : intent.kind === 'closeProject' ? '关闭' : '退出'
  const title = intent.kind === 'switchProject' ? '切换项目' : intent.kind === 'closeProject' ? '关闭项目' : '退出 Kiny Editor'
  const dirty = dirtyCount > 0

  let body: string
  let buttons: ReactNode
  if (aiRunning && !dirty) {
    // 仅 AI 在跑：无保存/丢弃语义，只有「中止并{动作}」与取消。
    body = `AI 正在运行，${action}将中止它。`
    buttons = (
      <>
        <button className="confirm-btn primary" autoFocus onClick={onDiscard}>中止并{action}</button>
        <button className="confirm-btn" onClick={onCancel}>取消</button>
      </>
    )
  } else if (aiRunning && dirty) {
    body = `AI 正在运行，且有 ${dirtyCount} 个文件未保存。${action}将中止 AI。`
    buttons = (
      <>
        <button className="confirm-btn primary" autoFocus onClick={onSave}>保存并{action}</button>
        <button className="confirm-btn" onClick={onDiscard}>丢弃并{action}</button>
        <button className="confirm-btn" onClick={onCancel}>取消</button>
      </>
    )
  } else {
    // 仅脏：保存 / 丢弃 / 取消。
    body = `有 ${dirtyCount} 个文件未保存，${action}前是否保存？`
    buttons = (
      <>
        <button className="confirm-btn primary" autoFocus onClick={onSave}>全部保存</button>
        <button className="confirm-btn" onClick={onDiscard}>不保存并{action}</button>
        <button className="confirm-btn" onClick={onCancel}>取消</button>
      </>
    )
  }

  return (
    <Scrim onCancel={onCancel} title={title}>
      <p className="confirm-body">{body}</p>
      <div className="confirm-actions">{buttons}</div>
    </Scrim>
  )
}

/** 遮罩 + 对话框壳（Esc / 点背景 = 取消，参照 HelpDialog）。 */
function Scrim({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="confirm-scrim" onClick={onCancel}>
      <div className="confirm-dlg" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}
