import { useRef, useState } from 'react'
import {
  type CustomTheme,
  THEME_VAR_GROUPS, PRESET_IDS, PRESET_LABEL, PRESET_VARS,
  effectiveBase, effectiveVars, newCustomTheme, dedupeName,
  contrastWarnings, exportTheme, parseImportedTheme,
} from '../state/themes'

export interface AppearanceSettingsProps {
  activeThemeId: string
  customThemes: CustomTheme[]
  /** 更新草稿（父组件据此实时 applyTheme 预览 + 纳入脏检测/保存）。 */
  onChange: (activeThemeId: string, customThemes: CustomTheme[]) => void
  /** 导出主题到文件（弹原生保存对话框 + 写盘）；取消返 false。由 gateway 注入，测试可传桩。 */
  saveThemeFile: (defaultName: string, contents: string) => Promise<boolean>
}

/**
 * 设置弹窗「外观」页：预设 + 自定义主题列表（单选即活动、实时应用），自定义主题可新建 / 编辑（取色面板）/
 * 重命名 / 删除 / 导入导出。只做 UI 配色白名单，语法高亮跟随基底。所有编辑经 onChange 回草稿，父组件实时预览。
 */
export function AppearanceSettings({ activeThemeId, customThemes, onChange, saveThemeFile }: AppearanceSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [importNotice, setImportNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const base = effectiveBase(activeThemeId, customThemes)
  const editing = editingId === null ? null : customThemes.find((t) => t.id === editingId) ?? null

  // 点主题行 = 选中该主题；同时收起取色面板（编辑面板只由 🎨 显式打开，避免选了别的主题却还开着旧面板、
  // 后续取色无预览）。编辑某主题时点它自己的 🎨 才进面板。
  const select = (id: string) => { onChange(id, customThemes); setEditingId(null) }
  const replaceList = (list: CustomTheme[], nextActive = activeThemeId) => onChange(nextActive, list)

  const onNew = () => {
    const t = newCustomTheme(base, customThemes)
    replaceList([...customThemes, t], t.id) // 新建即选中、实时应用（overrides 空 = 视觉等同基底）
    setEditingId(t.id)
  }

  const onDelete = (t: CustomTheme) => {
    const list = customThemes.filter((x) => x.id !== t.id)
    // 删除活动主题 → 回落其基底预设
    replaceList(list, activeThemeId === t.id ? t.base : activeThemeId)
    if (editingId === t.id) setEditingId(null)
    if (renamingId === t.id) setRenamingId(null)
  }

  const commitRename = (t: CustomTheme) => {
    const name = renameText.trim()
    if (name) {
      const others = customThemes.filter((x) => x.id !== t.id)
      replaceList(customThemes.map((x) => (x.id === t.id ? { ...x, name: dedupeName(name, others) } : x)))
    }
    setRenamingId(null)
  }

  const setVar = (t: CustomTheme, varName: string, value: string) => {
    const overrides = { ...t.overrides, [varName]: value }
    replaceList(customThemes.map((x) => (x.id === t.id ? { ...x, overrides } : x)))
  }
  const resetVar = (t: CustomTheme, varName: string) => {
    const overrides = { ...t.overrides }
    delete overrides[varName]
    replaceList(customThemes.map((x) => (x.id === t.id ? { ...x, overrides } : x)))
  }

  const onExport = async (t: CustomTheme) => {
    try {
      await saveThemeFile(`${t.name || 'theme'}.kiny-theme.json`, exportTheme(t))
    } catch (e) {
      setImportNotice({ kind: 'err', text: `导出失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const onImportFile = async (file: File) => {
    const text = await file.text()
    const r = parseImportedTheme(text)
    if (!r.ok) {
      setImportNotice({ kind: 'err', text: r.error })
      return
    }
    const t: CustomTheme = { id: newCustomTheme(r.base, customThemes).id, name: dedupeName(r.name, customThemes), base: r.base, overrides: r.overrides }
    replaceList([...customThemes, t], t.id)
    setEditingId(t.id)
    setImportNotice({ kind: 'ok', text: r.skipped > 0 ? `已导入「${t.name}」（跳过 ${r.skipped} 个非法配色）` : `已导入「${t.name}」` })
  }

  const warnings = editing ? contrastWarnings(effectiveVars(editing.base, editing.overrides)) : []

  return (
    <div className="settings-grp appearance">
      <div className="settings-help">选择编辑器界面配色。语法高亮跟随所选主题的明暗基底——自定义背景时请选与目标背景一致的基底。</div>

      <ul className="theme-list" role="radiogroup" aria-label="主题">
        {PRESET_IDS.map((id) => (
          <li key={id} className={'theme-item' + (activeThemeId === id ? ' on' : '')}>
            <button role="radio" aria-checked={activeThemeId === id} className="theme-pick" onClick={() => select(id)}>
              <ThemeSwatch vars={PRESET_VARS[id]} />
              <span className="theme-name">{PRESET_LABEL[id]}</span>
              <span className="theme-badge">预设</span>
            </button>
          </li>
        ))}
        {customThemes.map((t) => (
          <li key={t.id} className={'theme-item' + (activeThemeId === t.id ? ' on' : '')}>
            {renamingId === t.id ? (
              <input
                className="theme-rename" autoFocus aria-label="主题名称" value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={() => commitRename(t)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(t); if (e.key === 'Escape') setRenamingId(null) }}
              />
            ) : (
              <button role="radio" aria-checked={activeThemeId === t.id} className="theme-pick" onClick={() => select(t.id)}>
                <ThemeSwatch vars={effectiveVars(t.base, t.overrides)} />
                <span className="theme-name">{t.name}</span>
                <span className="theme-badge muted">{PRESET_LABEL[t.base]}</span>
              </button>
            )}
            <div className="theme-actions">
              <button className="theme-act" aria-label={`编辑 ${t.name}`} title="编辑配色"
                onClick={() => { select(t.id); setEditingId(editingId === t.id ? null : t.id) }}>🎨</button>
              <button className="theme-act" aria-label={`重命名 ${t.name}`} title="重命名"
                onClick={() => { setRenamingId(t.id); setRenameText(t.name) }}>✎</button>
              <button className="theme-act" aria-label={`导出 ${t.name}`} title="导出" onClick={() => void onExport(t)}>⇩</button>
              <button className="theme-act danger" aria-label={`删除 ${t.name}`} title="删除" onClick={() => onDelete(t)}>🗑</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="theme-toolbar">
        <button className="settings-btn" onClick={onNew}>＋ 新建自定义主题</button>
        <button className="settings-btn" onClick={() => fileRef.current?.click()}>导入…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          aria-hidden={true} tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.target.value = '' }} />
      </div>
      {importNotice && (
        <div className={'settings-help ' + (importNotice.kind === 'err' ? 'theme-import-err' : 'theme-import-ok')} role="status">
          {importNotice.text}
        </div>
      )}

      {editing && (
        <div className="theme-editor">
          <div className="settings-cat">编辑「{editing.name}」配色</div>
          {THEME_VAR_GROUPS.map((g) => (
            <div key={g.label} className="theme-group">
              <div className="theme-group-label">{g.label}</div>
              {g.vars.map((v) => {
                const val = editing.overrides[v] ?? PRESET_VARS[editing.base][v]!
                const overridden = v in editing.overrides
                return (
                  <div key={v} className="theme-var-row">
                    <input type="color" aria-label={v} value={normalizeHex(val)}
                      onChange={(e) => setVar(editing, v, e.target.value)} />
                    <input className="theme-var-hex" aria-label={`${v} 十六进制`} value={val}
                      onChange={(e) => setVar(editing, v, e.target.value)} />
                    <code className="theme-var-name">{v}</code>
                    {overridden && (
                      <button className="theme-var-reset" title="恢复基底值" aria-label={`恢复 ${v} 基底值`}
                        onClick={() => resetVar(editing, v)}>↺</button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {warnings.length > 0 && (
            <div className="theme-contrast-warn" role="status">
              ⚠ 对比度偏低（低于 WCAG AA，仍可保存）：
              <ul>
                {warnings.map((w) => (
                  <li key={w.label}>{w.label}：{w.ratio.toFixed(1)}:1（建议 ≥ {w.threshold}:1）</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 主题小样：五色横条（背景 / 面板 / 边框 / 文字 / 强调）。接有效变量集，与预设/自定义解耦。 */
function ThemeSwatch({ vars }: { vars: Record<string, string> }) {
  const cells = ['--bg-0', '--bg-2', '--border', '--text', '--accent']
  return (
    <span className="theme-swatch" aria-hidden={true}>
      {cells.map((c) => <span key={c} style={{ background: vars[c] }} />)}
    </span>
  )
}

/** <input type="color"> 只接受 #rrggbb；把 #rgb 展开、非 hex 回落黑，避免报错（hex 文本框仍显原值）。 */
function normalizeHex(v: string): string {
  const s = v.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('').toLowerCase()
  return '#000000'
}
