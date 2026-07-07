import { useEffect, useState } from 'react'
import type { Manifest } from '../files/gateway'

export interface ProjectSettingsDialogProps {
  open: boolean
  manifest: Manifest | null
  /** 当前项目全部 .kin 文件（相对路径，升序），作启动入口下拉选项。 */
  kinFiles: string[]
  /** 保存草稿（version 已归一：空串回退原值）。失败由父弹 notice、弹窗留驻。 */
  onSave: (draft: Manifest) => void
  onCancel: () => void
}

/**
 * 项目设置弹窗：编辑当前项目 manifest（项目名 / 启动入口 / version；engine 只读）。
 * 与全局 SettingsDialog 平级、互不引用——本弹窗写项目 manifest（磁盘），SettingsDialog 写 localStorage。
 * 复用 .settings-* 样式类保持观感一致。
 */
export function ProjectSettingsDialog({ open, manifest, kinFiles, onSave, onCancel }: ProjectSettingsDialogProps) {
  const [draft, setDraft] = useState<Manifest | null>(manifest)

  // 打开时以当前 manifest 为种子初始化草稿
  useEffect(() => { if (open) setDraft(manifest) }, [open, manifest])

  // Esc = 取消（仅打开时挂）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || !manifest || !draft) return null

  // version 空串 = 保留原值（不报错、不打断保存）
  const effVersion = draft.version.trim() === '' ? manifest.version : draft.version
  const dirty = draft.name !== manifest.name || draft.entry !== manifest.entry || effVersion !== manifest.version

  // 防御性：下拉至少含当前 entry（理论上 readProject 保证入口存在于 .kin 集合）
  const entryOptions = kinFiles.includes(draft.entry) ? kinFiles : [draft.entry, ...kinFiles]

  return (
    <div className="settings-scrim" onClick={onCancel}>
      <div className="settings-dlg" role="dialog" aria-modal="true" aria-label="项目设置" onClick={(e) => e.stopPropagation()}>
        <button className="settings-close" aria-label="关闭" onClick={onCancel}>×</button>
        <div className="settings-head">
          <span className="settings-title"><b>项目设置</b></span>
          <span className="settings-ver">当前项目</span>
          {dirty && <span className="settings-dirty">● 未保存的改动</span>}
        </div>

        <div className="settings-body">
          <div className="settings-cat">项目</div>
          <div className="settings-grp">
            <div className="settings-row">
              <div className="settings-label">项目名称</div>
              <input className="settings-input" aria-label="项目名称" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="settings-help">项目文件（<code>.kiw</code>）会随项目名重命名；名称里的 <code>\ / : * ? " &lt; &gt; |</code> 等非法字符在文件名中会被自动去除。</div>
            <div className="settings-row">
              <div className="settings-label">启动入口</div>
              <select className="settings-sel" aria-label="启动入口" value={draft.entry}
                onChange={(e) => setDraft({ ...draft, entry: e.target.value })}>
                {entryOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="settings-help">预览与导出从该 <code>.kin</code> 文件开始。</div>
            <div className="settings-row">
              <div className="settings-label">项目版本</div>
              <input className="settings-input" aria-label="项目版本" placeholder={manifest.version} value={draft.version}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
            </div>
            <div className="settings-row">
              <div className="settings-label">引擎版本</div>
              <span className="settings-readonly" aria-label="引擎版本">{manifest.engine}</span>
            </div>
          </div>
        </div>

        <div className="settings-foot">
          <span className="settings-foot-spacer" />
          <button className="settings-btn" onClick={onCancel}>取消</button>
          <button className="settings-btn primary" disabled={!dirty}
            onClick={() => onSave({ ...draft, version: effVersion })}>保存</button>
        </div>
      </div>
    </div>
  )
}
