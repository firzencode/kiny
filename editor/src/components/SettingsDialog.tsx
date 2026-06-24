import { useEffect, useState } from 'react'
import {
  type Settings, DEFAULT_SETTINGS, SETTINGS_BOUNDS,
  CODE_FONTS, PROSE_FONTS, CODE_FONT_FALLBACK, PROSE_FONT_FALLBACK,
  type FontPreset, sanitizeFontName,
} from '../state/settings'

type Theme = 'dark' | 'light'

export interface SettingsDialogProps {
  open: boolean
  settings: Settings
  theme: Theme
  onSave: (next: Settings, theme: Theme) => void
  onCancel: () => void
}

const eqSettings = (a: Settings, b: Settings) =>
  a.codeFont === b.codeFont && a.codeSize === b.codeSize && a.codeLh === b.codeLh &&
  a.proseFont === b.proseFont && a.proseSize === b.proseSize && a.proseLh === b.proseLh

const decimals = (step: number) => (step.toString().split('.')[1] || '').length

/** 数值步进器：±step 并夹紧到 [min,max]，对外回 number。 */
function Stepper({ label, unit, bounds, value, onChange }: {
  label: string; unit: string
  bounds: { min: number; max: number; step: number }
  value: number; onChange: (v: number) => void
}) {
  const { min, max, step } = bounds
  const dec = decimals(step)
  const set = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v))
    onChange(Number(clamped.toFixed(dec)))
  }
  return (
    <div className="settings-row">
      <div className="settings-label">{label}</div>
      <div className="settings-stepper">
        <button aria-label={`减小${label}`} disabled={value <= min + 1e-9} onClick={() => set(value - step)}>−</button>
        <span className={'settings-stepval' + (unit ? '' : ' nounit')}>{value.toFixed(dec)}</span>
        {unit && <span className="settings-unit">{unit}</span>}
        <button aria-label={`增大${label}`} disabled={value >= max - 1e-9} onClick={() => set(value + step)}>+</button>
      </div>
    </div>
  )
}

/** 字体下拉 + 「自定义...」逃生口。value 是完整字体栈；自定义时把输入名拼到回退栈前。 */
function FontRow({ label, value, presets, fallback, onChange }: {
  label: string; value: string; presets: FontPreset[]; fallback: string; onChange: (v: string) => void
}) {
  const matched = presets.find((p) => p.value === value)
  const isCustom = !matched
  const customName = isCustom ? (/^'([^']*)'/.exec(value)?.[1] ?? '') : ''
  const compose = (name: string) => (name ? `'${name}', ${fallback}` : fallback)
  return (
    <div className="settings-row">
      <div className="settings-label">{label}</div>
      <div className="settings-fontctl">
        <select className="settings-sel" aria-label={label} value={isCustom ? '__custom__' : value}
          onChange={(e) => onChange(e.target.value === '__custom__' ? compose(customName) : e.target.value)}>
          {presets.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
          <option value="__custom__">自定义...</option>
        </select>
        {isCustom && (
          <input className="settings-custom" placeholder="字体名，如 Fira Code" value={customName}
            onChange={(e) => onChange(compose(sanitizeFontName(e.target.value)))} />
        )}
      </div>
    </div>
  )
}

export function SettingsDialog({ open, settings, theme, onSave, onCancel }: SettingsDialogProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [draftTheme, setDraftTheme] = useState<Theme>(theme)

  // 打开时从当前已提交值初始化草稿
  useEffect(() => { if (open) { setDraft(settings); setDraftTheme(theme) } }, [open, settings, theme])

  // Esc = 取消（仅打开时挂）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  const dirty = !eqSettings(draft, settings) || draftTheme !== theme

  return (
    <div className="settings-scrim" onClick={onCancel}>
      <div className="settings-dlg" role="dialog" aria-modal="true" aria-label="设置" onClick={(e) => e.stopPropagation()}>
        <button className="settings-close" aria-label="关闭" onClick={onCancel}>×</button>
        <div className="settings-head">
          <span className="settings-title"><b>设置</b></span>
          <span className="settings-ver">排版偏好</span>
          {dirty && <span className="settings-dirty">● 未保存的改动（仅预览中）</span>}
        </div>

        <div className="settings-body">
          <div className="settings-cat">代码区</div>
          <div className="settings-grp">
            <FontRow label="代码字体" value={draft.codeFont} presets={CODE_FONTS} fallback={CODE_FONT_FALLBACK}
              onChange={(v) => setDraft({ ...draft, codeFont: v })} />
            <Stepper label="代码字号" unit="px" bounds={SETTINGS_BOUNDS.codeSize} value={draft.codeSize}
              onChange={(v) => setDraft({ ...draft, codeSize: v })} />
            <Stepper label="代码行距" unit="" bounds={SETTINGS_BOUNDS.codeLh} value={draft.codeLh}
              onChange={(v) => setDraft({ ...draft, codeLh: v })} />
            <div className="settings-swatch" data-theme={draftTheme}
              style={{ fontFamily: draft.codeFont, fontSize: draft.codeSize, lineHeight: draft.codeLh }}>
              <div className="settings-swatch-tag">预览</div>
              <pre className="settings-pre">{`=== 雾港开场 ===\n~ let gold = 10\n你还剩 {gold} 枚金币。`}</pre>
            </div>
          </div>

          <div className="settings-cat">正文区</div>
          <div className="settings-grp">
            <FontRow label="正文字体" value={draft.proseFont} presets={PROSE_FONTS} fallback={PROSE_FONT_FALLBACK}
              onChange={(v) => setDraft({ ...draft, proseFont: v })} />
            <Stepper label="正文字号" unit="px" bounds={SETTINGS_BOUNDS.proseSize} value={draft.proseSize}
              onChange={(v) => setDraft({ ...draft, proseSize: v })} />
            <Stepper label="正文行距" unit="" bounds={SETTINGS_BOUNDS.proseLh} value={draft.proseLh}
              onChange={(v) => setDraft({ ...draft, proseLh: v })} />
            <div className="settings-swatch" data-theme={draftTheme}
              style={{ fontFamily: draft.proseFont, fontSize: draft.proseSize, lineHeight: draft.proseLh }}>
              <div className="settings-swatch-tag">预览</div>雾从港口涌上来，遮住了路灯。「想要点什么？」老板问。
            </div>
          </div>

          <div className="settings-cat">外观</div>
          <div className="settings-grp">
            <div className="settings-row">
              <div className="settings-label">主题</div>
              <div className="settings-seg" role="group" aria-label="主题">
                {(['dark', 'light'] as Theme[]).map((t) => (
                  <button key={t} className={'settings-seg-btn' + (draftTheme === t ? ' on' : '')}
                    aria-pressed={draftTheme === t} onClick={() => setDraftTheme(t)}>
                    {t === 'dark' ? '石板墨' : '象牙稿'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-foot">
          <button className="settings-btn" onClick={() => { setDraft(DEFAULT_SETTINGS); setDraftTheme('dark') }}>恢复默认</button>
          <span className="settings-foot-spacer" />
          <button className="settings-btn" onClick={onCancel}>取消</button>
          <button className="settings-btn primary" disabled={!dirty} onClick={() => onSave(draft, draftTheme)}>保存</button>
        </div>
      </div>
    </div>
  )
}
