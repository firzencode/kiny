import { useEffect, useRef, useState } from 'react'
import { sanitizeProjectBase } from '../files/gateway'

export interface NewProjectDialogProps {
  open: boolean
  /** 「浏览…」：弹原生目录选择器选父目录，取消返 null。 */
  onBrowse: () => Promise<string | null>
  /** 创建：成功返 null（弹窗由父组件关闭）；失败返错误串，内联显示、弹窗留驻。 */
  onCreate: (parentDir: string, name: string) => Promise<string | null>
  onCancel: () => void
}

/**
 * 新建项目弹窗：填项目名 + 选存放位置 → 在父目录下建同名子文件夹。
 * 纯展示 + 本地表单态，gateway 调用由 App 以回调注入。复用 .settings-* 弹窗样式。
 */
export function NewProjectDialog({ open, onBrowse, onCreate, onCancel }: NewProjectDialogProps) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  // 打开时重置表单并聚焦名称框
  useEffect(() => {
    if (!open) return
    setName(''); setLocation(''); setError(null); setBusy(false)
    const id = window.setTimeout(() => nameRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  const base = sanitizeProjectBase(name)
  const canCreate = base !== '' && location.trim() !== '' && !busy
  const sep = location.includes('\\') ? '\\' : '/'
  const preview = base && location ? `${location}${sep}${base}${sep}` : null

  const browse = async () => {
    const dir = await onBrowse()
    if (dir !== null) setLocation(dir)
  }
  const submit = async () => {
    if (!canCreate) return
    setBusy(true); setError(null)
    const err = await onCreate(location, name)
    if (err !== null) { setError(err); setBusy(false) }
    // 成功：父组件把 open 置 false，弹窗卸载，无需复位 busy
  }

  return (
    // 点遮罩空白处不关闭（避免误触丢失已填内容）——仅 ×／取消／Esc 可关。
    <div className="settings-scrim">
      <div
        className="settings-dlg" role="dialog" aria-modal="true" aria-label="新建项目"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() }
          else if (e.key === 'Escape') onCancel()
        }}
      >
        <button className="settings-close" aria-label="关闭" onClick={onCancel}>×</button>
        <div className="settings-head">
          <span className="settings-title"><b>新建项目</b></span>
        </div>

        <div className="settings-body">
          <div className="settings-cat">项目</div>
          <div className="settings-grp">
            <div className="settings-row">
              <div className="settings-label">项目名称</div>
              <input
                ref={nameRef} className="settings-input" aria-label="项目名称"
                value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
              />
            </div>
            <div className="settings-row">
              <div className="settings-label">位置</div>
              <input className="settings-input" aria-label="位置" readOnly value={location} placeholder="（未选择）" />
              <button className="settings-btn" onClick={browse} disabled={busy}>浏览…</button>
            </div>
            <div className="settings-help">
              {preview ? <>将创建 <code>{preview}</code></> : '选择一个文件夹，会在其中新建同名子文件夹存放项目。'}
            </div>
            {error && <p className="settings-error" role="alert">{error}</p>}
          </div>
        </div>

        <div className="settings-foot">
          <span className="settings-foot-spacer" />
          <button className="settings-btn" onClick={onCancel}>取消</button>
          <button className="settings-btn primary" disabled={!canCreate} onClick={submit}>创建</button>
        </div>
      </div>
    </div>
  )
}
