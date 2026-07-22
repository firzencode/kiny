import { useEffect, useState } from 'react'
import {
  type Settings, DEFAULT_SETTINGS, SETTINGS_BOUNDS, AI_CHAT_RETENTION_BOUNDS,
  CODE_FONTS, PROSE_FONTS, CODE_FONT_FALLBACK, PROSE_FONT_FALLBACK,
  type FontPreset, sanitizeFontName,
} from '../state/settings'
import { type AiConfig, DEFAULT_AI_CONFIG } from '../ai/aiConfig'
import { ShortcutsSettings } from './ShortcutsSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { type CustomTheme, applyTheme, effectiveBase, isPresetId } from '../state/themes'
import { openUrl } from '@tauri-apps/plugin-opener'

/** 外部控制的 CLI/skill 文档仓（GitHub）。 */
const KINY_CLI_DOCS_URL = 'https://github.com/firzencode/kiny-cli'

/** 主题态：活动主题 id（预设或自定义 id）+ 自定义主题列表，作为一个整体在弹窗草稿/保存流转。 */
export interface ThemeState {
  activeThemeId: string
  customThemes: CustomTheme[]
}

// 设置分类 tab：数组描述便于扩展。
type TabId = 'typography' | 'appearance' | 'editor' | 'ai' | 'shortcuts'
const TABS: { id: TabId; label: string }[] = [
  { id: 'typography', label: '排版' },
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'ai', label: 'AI' },
]

export interface SettingsDialogProps {
  open: boolean
  settings: Settings
  activeThemeId: string
  customThemes: CustomTheme[]
  aiConfig: AiConfig
  /** 外部控制运行态（T040）：非 null 时显示「运行中 · 端口 N」，仅只读展示，不受此弹窗控制。 */
  controlInfo: { port: number } | null
  onSave: (next: Settings, theme: ThemeState, aiConfig: AiConfig) => void
  onCancel: () => void
  /** 导出自定义主题到文件（外观页透传给 AppearanceSettings）；取消返 false。 */
  onExportTheme: (defaultName: string, contents: string) => Promise<boolean>
}

/** 主题态语义相等（活动 id + 自定义列表逐项 id/name/base/overrides 同）。 */
function themeStateEq(a: ThemeState, b: ThemeState): boolean {
  if (a.activeThemeId !== b.activeThemeId) return false
  if (a.customThemes.length !== b.customThemes.length) return false
  return a.customThemes.every((t, i) => {
    const o = b.customThemes[i]
    if (!o || t.id !== o.id || t.name !== o.name || t.base !== o.base) return false
    const tk = Object.keys(t.overrides)
    const ok = Object.keys(o.overrides)
    return tk.length === ok.length && tk.every((k) => t.overrides[k] === o.overrides[k])
  })
}

const decimals = (step: number) => (step.toString().split('.')[1] || '').length

/** 快捷键覆盖分片语义相等（键集与值均同）。 */
function shortcutsEq(a: Settings['shortcuts'], b: Settings['shortcuts']): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a[k as keyof typeof a] === b[k as keyof typeof b])
}

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

export function SettingsDialog({ open, settings, activeThemeId, customThemes, aiConfig, controlInfo, onSave, onCancel, onExportTheme }: SettingsDialogProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [draftTheme, setDraftTheme] = useState<ThemeState>({ activeThemeId, customThemes })
  const [draftAi, setDraftAi] = useState<AiConfig>(aiConfig)
  const [showKey, setShowKey] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('typography')

  // 草稿与已提交值对齐：打开时初始化、**关闭时也重置**——否则下次打开会先用上次取消的草稿主题
  // 跑一帧实时预览（闪一下旧配色）再被本 effect 纠正。activeTab 仅打开时重置到「排版」（不跨会话记忆）。
  useEffect(() => {
    setDraft(settings); setDraftTheme({ activeThemeId, customThemes }); setDraftAi(aiConfig)
    if (open) { setShowKey(false); setActiveTab('typography') }
  }, [open, settings, activeThemeId, customThemes, aiConfig])

  // 主题实时预览：草稿主题一变即 applyTheme 到 documentElement，用户马上看到（保存才落 localStorage）。
  useEffect(() => { if (open) applyTheme(draftTheme.activeThemeId, draftTheme.customThemes) }, [open, draftTheme])

  // 取消 / 关闭：把 documentElement 主题回滚到已提交态（撤销实时预览的临时改动），再走 onCancel。
  const cancel = () => { applyTheme(activeThemeId, customThemes); onCancel() }

  // Esc = 取消（仅打开时挂）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onCancel, activeThemeId, customThemes])

  if (!open) return null
  const draftBase = effectiveBase(draftTheme.activeThemeId, draftTheme.customThemes)
  // 字体预览小样的 data-theme：预设直接用其自身 id（素雪白 plain 的明暗基底是 light，用 draftBase 会把
  // 小样渲染成象牙稿米白而非纯白），自定义回落基底——与 applyTheme 一致。
  const swatchTheme = isPresetId(draftTheme.activeThemeId) ? draftTheme.activeThemeId : draftBase
  const aiEq = draftAi.endpoint === aiConfig.endpoint && draftAi.model === aiConfig.model && draftAi.apiKey === aiConfig.apiKey
  // 按 tab 拆分脏标记分片（左栏各 tab 脏点用）；全局 dirty = 各分片之或（等价旧 eqSettings 组合）。
  const dirtyTypo = draft.codeFont !== settings.codeFont || draft.codeSize !== settings.codeSize || draft.codeLh !== settings.codeLh ||
    draft.proseFont !== settings.proseFont || draft.proseSize !== settings.proseSize || draft.proseLh !== settings.proseLh
  const dirtyAppearance = !themeStateEq(draftTheme, { activeThemeId, customThemes })
  const dirtyEditor = draft.autosaveRecovery !== settings.autosaveRecovery || draft.previewRandomSeed !== settings.previewRandomSeed
  const dirtyShortcuts = !shortcutsEq(draft.shortcuts, settings.shortcuts)
  const dirtyAi = !aiEq || draft.aiChatRetentionDays !== settings.aiChatRetentionDays || draft.externalControl !== settings.externalControl
  const tabDirty: Record<TabId, boolean> = { typography: dirtyTypo, appearance: dirtyAppearance, editor: dirtyEditor, shortcuts: dirtyShortcuts, ai: dirtyAi }
  const dirty = dirtyTypo || dirtyAppearance || dirtyEditor || dirtyShortcuts || dirtyAi

  return (
    // 点遮罩空白处不关闭（避免误触丢失未保存改动）——仅 ×／取消／Esc 可关。
    <div className="settings-scrim">
      <div className="settings-dlg" role="dialog" aria-modal="true" aria-label="设置">
        <button className="settings-close" aria-label="关闭" onClick={cancel}>×</button>
        <div className="settings-head">
          <span className="settings-title"><b>设置</b></span>
          <span className="settings-ver">排版偏好</span>
          {dirty && <span className="settings-dirty">● 未保存的改动（仅预览中）</span>}
        </div>

        <div className="settings-body tabbed">
          <div className="settings-nav" role="tablist" aria-label="设置分类">
            {TABS.map((t) => (
              <button
                key={t.id} type="button" role="tab" aria-selected={activeTab === t.id}
                className={'settings-nav-item' + (activeTab === t.id ? ' on' : '')}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="settings-nav-label">{t.label}</span>
                {tabDirty[t.id] && <span className="settings-nav-dot" aria-hidden={true}>●</span>}
              </button>
            ))}
          </div>

          <div className="settings-pane" role="tabpanel">
            {activeTab === 'typography' && (<>
              <div className="settings-cat">代码区</div>
              <div className="settings-grp">
                <FontRow label="代码字体" value={draft.codeFont} presets={CODE_FONTS} fallback={CODE_FONT_FALLBACK}
                  onChange={(v) => setDraft({ ...draft, codeFont: v })} />
                <Stepper label="代码字号" unit="px" bounds={SETTINGS_BOUNDS.codeSize} value={draft.codeSize}
                  onChange={(v) => setDraft({ ...draft, codeSize: v })} />
                <Stepper label="代码行距" unit="" bounds={SETTINGS_BOUNDS.codeLh} value={draft.codeLh}
                  onChange={(v) => setDraft({ ...draft, codeLh: v })} />
                <div className="settings-swatch" data-theme={swatchTheme}
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
                <div className="settings-swatch" data-theme={swatchTheme}
                  style={{ fontFamily: draft.proseFont, fontSize: draft.proseSize, lineHeight: draft.proseLh }}>
                  <div className="settings-swatch-tag">预览</div>雾从港口涌上来，遮住了路灯。「想要点什么？」老板问。
                </div>
              </div>
            </>)}

            {activeTab === 'appearance' && (
              <AppearanceSettings
                activeThemeId={draftTheme.activeThemeId}
                customThemes={draftTheme.customThemes}
                onChange={(nextActive, nextCustom) => setDraftTheme({ activeThemeId: nextActive, customThemes: nextCustom })}
                saveThemeFile={onExportTheme}
              />
            )}

            {activeTab === 'editor' && (
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
                <div className="settings-row">
                  <span className="settings-label">预览随机种子</span>
                  <button
                    className={'settings-toggle' + (draft.previewRandomSeed ? ' on' : '')}
                    role="switch" aria-checked={draft.previewRandomSeed} aria-label="预览随机种子"
                    onClick={() => setDraft({ ...draft, previewRandomSeed: !draft.previewRandomSeed })}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
                <div className="settings-help">开启后，每次「重开预览」（↺）都换一枚新随机种子，便于查看 random / shuffle 的多样性。关闭则恒用固定种子，预览可复现（默认）。</div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <ShortcutsSettings
                overrides={draft.shortcuts}
                onChange={(next) => setDraft({ ...draft, shortcuts: next })}
              />
            )}

            {activeTab === 'ai' && (
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
                    <button className="key-toggle" type="button" aria-label="清除 API Key"
                      disabled={draftAi.apiKey === ''}
                      onClick={() => setDraftAi({ ...draftAi, apiKey: '' })}>清除</button>
                  </div>
                </div>
                <div className="settings-help">⚠ API key 以<b>明文</b>存于本机浏览器存储（localStorage），并未加密。共享 / 公用设备上用完请点「清除」（清空后保存生效）；敏感环境建议改用你信任的私人设备。</div>
                <div className="settings-trust">
                  <span className="lock">🔒</span>
                  <div>API key 与每一次请求都只在本机，<b>直连你配置的 endpoint</b>，不经 Kiny 任何服务器中转或托管。你用的是自己的 key、自己的额度。</div>
                </div>
                <div className="settings-row">
                  <span className="settings-label">自动清理对话记录</span>
                  <div className="settings-retention">
                    <button
                      className={'settings-toggle' + (draft.aiChatRetentionDays !== null ? ' on' : '')}
                      role="switch" aria-checked={draft.aiChatRetentionDays !== null} aria-label="自动清理 AI 对话记录"
                      onClick={() => setDraft({ ...draft, aiChatRetentionDays: draft.aiChatRetentionDays === null ? DEFAULT_SETTINGS.aiChatRetentionDays : null })}
                    >
                      <span className="settings-toggle-knob" />
                    </button>
                    {draft.aiChatRetentionDays !== null && (
                      <span className="settings-retention-days">
                        <input
                          className="settings-input settings-num" type="number" aria-label="保留天数"
                          min={AI_CHAT_RETENTION_BOUNDS.min} max={AI_CHAT_RETENTION_BOUNDS.max}
                          value={draft.aiChatRetentionDays}
                          onChange={(e) => {
                            const n = Math.floor(Number(e.target.value))
                            if (Number.isFinite(n) && n >= AI_CHAT_RETENTION_BOUNDS.min) {
                              setDraft({ ...draft, aiChatRetentionDays: Math.min(AI_CHAT_RETENTION_BOUNDS.max, n) })
                            }
                          }}
                        />
                        <span className="settings-unit">天</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="settings-help">距今超过设定天数没有新增内容的 AI 对话，会在下次启动时自动删除；关闭则永久保留。对话历史仅存本机（app 数据目录），含 key 的请求不入库。</div>

                <div className="settings-cat">外部控制</div>
                <div className="settings-row">
                  <span className="settings-label">启用外部控制</span>
                  <button
                    className={'settings-toggle' + (draft.externalControl ? ' on' : '')}
                    role="switch" aria-checked={draft.externalControl} aria-label="启用外部控制"
                    onClick={() => setDraft({ ...draft, externalControl: !draft.externalControl })}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
                <div className="settings-help">
                  开启后，会在本机 127.0.0.1 上开启一个 REST 服务，外部 AI Agent 可以使用 API
                  来驱动编辑器，进行完整的项目编写和编辑器控制。详情内容请查看：
                  <a
                    href={KINY_CLI_DOCS_URL}
                    onClick={(e) => {
                      e.preventDefault()
                      void openUrl(KINY_CLI_DOCS_URL)
                    }}
                  >
                    {KINY_CLI_DOCS_URL}
                  </a>
                </div>
                {controlInfo !== null && (
                  <div className="settings-row">
                    <span className="settings-label">运行状态</span>
                    <span className="settings-control-status">运行中 · 端口 {controlInfo.port}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="settings-foot">
          <button className="settings-btn" onClick={() => { setDraft(DEFAULT_SETTINGS); setDraftTheme({ activeThemeId: 'dark', customThemes: draftTheme.customThemes }); setDraftAi(DEFAULT_AI_CONFIG) }}>恢复默认</button>
          <span className="settings-foot-spacer" />
          <button className="settings-btn" onClick={cancel}>取消</button>
          <button className="settings-btn primary" disabled={!dirty} onClick={() => onSave(draft, draftTheme, draftAi)}>保存</button>
        </div>
      </div>
    </div>
  )
}
