import { useEffect, useState } from 'react'

export type ConflictChoice = 'overwrite' | 'rename' | 'skip'

export interface ImportConflictDialogProps {
  /** 冲突的目标相对路径；null = 不渲染。 */
  destRel: string | null
  /** 选择后回调；applyRest = 是否对本批其余冲突同样处理。 */
  onChoose: (choice: ConflictChoice, applyRest: boolean) => void
}

/** 导入资源遇同名文件时的三选确认框（覆盖 / 改名 / 跳过）。参照 ConfirmCloseDialog：Esc = 跳过。 */
export function ImportConflictDialog({ destRel, onChoose }: ImportConflictDialogProps) {
  const [applyRest, setApplyRest] = useState(false)

  // 每次弹出（destRel 变化）重置「应用到其余」勾选，避免残留上次状态。
  useEffect(() => { setApplyRest(false) }, [destRel])

  useEffect(() => {
    if (destRel === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onChoose('skip', applyRest) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [destRel, applyRest, onChoose])

  if (destRel === null) return null

  return (
    <div className="confirm-scrim" onClick={() => onChoose('skip', applyRest)}>
      <div
        className="confirm-dlg"
        role="dialog"
        aria-modal="true"
        aria-label="资源同名冲突"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirm-title">资源已存在</h2>
        <p className="confirm-body">「{destRel}」已存在。要如何处理？</p>
        <label className="confirm-checkbox">
          <input type="checkbox" checked={applyRest} onChange={(e) => setApplyRest(e.target.checked)} />
          对本次其余冲突同样处理
        </label>
        <div className="confirm-actions">
          <button className="confirm-btn primary" autoFocus onClick={() => onChoose('overwrite', applyRest)}>覆盖</button>
          <button className="confirm-btn" onClick={() => onChoose('rename', applyRest)}>改名</button>
          <button className="confirm-btn" onClick={() => onChoose('skip', applyRest)}>跳过</button>
        </div>
      </div>
    </div>
  )
}
