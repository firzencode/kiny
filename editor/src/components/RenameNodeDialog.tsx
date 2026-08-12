import { useEffect, useMemo, useRef, useState } from 'react'
import { computeRenamePlan, type RenamePlan, type RenameTarget } from '../refactor/renameNode'

/**
 * 节点重命名弹窗：输入新名时**实时**计算重命名计划（影响面 / 警告 / 合法性），
 * 确认后把已算好的计划交给 App 应用（dispatch 落脏标记，不写盘）。
 */
export function RenameNodeDialog({
  buffers,
  target,
  onApply,
  onCancel,
}: {
  /** 全部 .kin 缓冲（含未保存改动）。 */
  buffers: { path: string; source: string }[]
  /** 待重命名的节点。 */
  target: RenameTarget
  /** 确认：把最终计划交回 App 应用。 */
  onApply: (plan: RenamePlan) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(target.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  const { plan, error } = useMemo(() => {
    const name = draft.trim()
    if (name === '' || name === target.name) return { plan: null, error: null }
    try {
      return { plan: computeRenamePlan(buffers, target, name), error: null }
    } catch (e) {
      return { plan: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [buffers, target, draft])

  const confirm = () => {
    if (plan !== null) onApply(plan)
  }

  return (
    <div className="confirm-scrim" onClick={onCancel}>
      <div
        className="confirm-dlg rename-dlg"
        role="dialog"
        aria-modal="true"
        aria-label="重命名节点"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-title">重命名节点「{target.name}」</div>
        <div className="confirm-body">
          <input
            ref={inputRef}
            className="rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && plan !== null) {
                e.preventDefault()
                confirm()
              }
            }}
            aria-label="新节点名"
          />
          {error !== null && <div className="rename-error" role="alert">{error}</div>}
          {plan !== null && (
            <div className="rename-impact">
              将更新 <b>{plan.referenceCount}</b> 处跳转引用（{plan.affectedFiles.length} 个文件），
              实参与限定名后缀原样保留。
              {plan.warnings.length > 0 && (
                <ul className="rename-warnings">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn primary" disabled={plan === null} onClick={confirm}>
            重命名
          </button>
          <button type="button" className="confirm-btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
