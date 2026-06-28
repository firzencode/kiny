import { useEffect, useState } from 'react'
import {
  type Settings, DEFAULT_SETTINGS, SETTINGS_BOUNDS,
  CODE_FONTS, PROSE_FONTS, CODE_FONT_FALLBACK, PROSE_FONT_FALLBACK,
  type FontPreset, sanitizeFontName,
} from '../state/settings'
import { type AiConfig, DEFAULT_AI_CONFIG } from '../ai/aiConfig'

type Theme = 'dark' | 'light'

export interface SettingsDialogProps {
  open: boolean
  settings: Settings
  theme: Theme
  aiConfig: AiConfig
  onSave: (next: Settings, theme: Theme, aiConfig: AiConfig) => void
  onCancel: () => void
}

const eqSettings = (a: Settings, b: Settings) =>
  a.codeFont === b.codeFont && a.codeSize === b.codeSize && a.codeLh === b.codeLh &&
  a.proseFont === b.proseFont && a.proseSize === b.proseSize && a.proseLh === b.proseLh &&
  a.autosaveRecovery === b.autosaveRecovery

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

export function SettingsDialog({ open, settings, theme, aiConfig, onSave, onCancel }: SettingsDialogProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [draftTheme, setDraftTheme] = useState<Theme>(theme)
  const [draftAi, setDraftAi] = useState<AiConfig>(aiConfig)
  const [showKey, setShowKey] = useState(false)

  // 打开时从当前已提交值初始化草稿
  useEffect(() => { if (open) { setDraft(settings); setDraftTheme(theme); setDraftAi(aiConfig); setShowKey(false) } }, [open, settings, theme, aiConfig])

  // Esc = 取消（仅打开时挂）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  const aiEq = draftAi.endpoint === aiConfig.endpoint && draftAi.model === aiConfig.model && draftAi.apiKey === aiConfig.apiKey
  const dirty = !eqSettings(draft, settings) || draftTheme !== theme || !aiEq

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

          <div className="settings-cat">编辑器</div>
          <div className="settings-grp">
            <div className="settings-row">
              <span className="settings-label">自动恢复草稿</span>
              <button
                className={'settings-toggle' + (draft.autosaveRecovery ? ' on' : '')}
                role="switch" aria-checked={draft.autosaveRecovery} aria-label="自动恢复草稿"
                onClick={() => setDraft({ ...draft, autosaveRecovery: !draft.autosaveRecovery })}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
            <div className="settings-help">开启后，未保存改动会在后台写入恢复草稿（不碰真文件）；崩溃或强制退出后重开项目，会提示恢复。关闭则不写草稿、不做恢复检测。</div>
          </div>

          <div className="settings-cat">AI</div>
          <div className="settings-grp">
            <div className="settings-row">
              <span className="settings-label">供应商</span>
              <div className="settings-seg" role="group" aria-label="供应商">
                <button className="settings-seg-btn on" aria-pressed="true">OpenAI 兼容</button>
                <button className="settings-seg-btn" disabled style={{ opacity: 0.4, cursor: 'default' }}>Anthropic（暂未支持）</button>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">Base URL</span>
              <input className="settings-input" aria-label="Base URL" placeholder="https://api.deepseek.com/v1"
                value={draftAi.endpoint} onChange={(e) => setDraftAi({ ...draftAi, endpoint: e.target.value })} />
            </div>
            <div className="settings-help">填供应商的 Base URL，会自动补 <code>/chat/completions</code>。例：DeepSeek <code>https://api.deepseek.com/v1</code>、OpenAI <code>https://api.openai.com/v1</code>、智谱 GLM <code>https://open.bigmodel.cn/api/coding/paas/v4</code>、本地 Ollama <code>http://localhost:11434/v1</code>。</div>
            <div className="settings-row">
              <span className="settings-label">模型</span>
              <input className="settings-input" aria-label="模型" placeholder="deepseek-chat"
                value={draftAi.model} onChange={(e) => setDraftAi({ ...draftAi, model: e.target.value })} />
            </div>
            <div className="settings-row">
              <span className="settings-label">API Key</span>
              <div className="key-wrap">
                <input className="settings-input" aria-label="API Key" type={showKey ? 'text' : 'password'}
                  value={draftAi.apiKey} onChange={(e) => setDraftAi({ ...draftAi, apiKey: e.target.value })} />
                <button className="key-toggle" type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? '隐藏' : '显示'}</button>
              </div>
            </div>
            <div className="settings-trust">
              <span className="lock">🔒</span>
              <div>API key 与每一次请求都只在本机，<b>直连你配置的 endpoint</b>，不经 Kiny 任何服务器中转或托管。你用的是自己的 key、自己的额度。</div>
            </div>
          </div>
        </div>

        <div className="settings-foot">
          <button className="settings-btn" onClick={() => { setDraft(DEFAULT_SETTINGS); setDraftTheme('dark'); setDraftAi(DEFAULT_AI_CONFIG) }}>恢复默认</button>
          <span className="settings-foot-spacer" />
          <button className="settings-btn" onClick={onCancel}>取消</button>
          <button className="settings-btn primary" disabled={!dirty} onClick={() => onSave(draft, draftTheme, draftAi)}>保存</button>
        </div>
      </div>
    </div>
  )
}
