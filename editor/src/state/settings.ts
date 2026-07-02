export interface Settings {
  codeFont: string
  codeSize: number
  codeLh: number
  proseFont: string
  proseSize: number
  proseLh: number
  /** 自动恢复草稿（spec §6）：脏缓冲后台写草稿、崩溃后重开检测恢复。默认开。 */
  autosaveRecovery: boolean
  /** 预览随机种子：开启后每次「重开预览」（↺）换新随机种子；关则恒用固定种子（确定性）。默认关。 */
  previewRandomSeed: boolean
  /** AI 对话记录自动清理阈值（天）：距今超此天数无新增的对话在启动时删除。null = 关闭（永久保留）。默认 30。 */
  aiChatRetentionDays: number | null
}

export const SETTINGS_KEY = 'kiny-editor-settings'

/** 字体回退栈（不含栈首与前导逗号）。栈首由用户所选/自定义拼到前面。 */
export const CODE_FONT_FALLBACK = `ui-monospace, 'SF Mono', Menlo, 'Noto Sans Mono CJK SC', monospace`
export const PROSE_FONT_FALLBACK = `'Noto Serif SC', STSong, serif`

export const DEFAULT_SETTINGS: Settings = {
  codeFont: `'JetBrains Mono', ${CODE_FONT_FALLBACK}`,
  codeSize: 13,
  codeLh: 1.7,
  proseFont: `'Songti SC', ${PROSE_FONT_FALLBACK}`,
  proseSize: 16.5,
  proseLh: 1.95,
  autosaveRecovery: true,
  previewRandomSeed: false,
  aiChatRetentionDays: 30,
}

/** AI 对话保留天数边界（自动清理开启时可调范围）。 */
export const AI_CHAT_RETENTION_BOUNDS = { min: 1, max: 365 } as const

export const SETTINGS_BOUNDS = {
  codeSize: { min: 12, max: 20, step: 1 },
  codeLh: { min: 1.2, max: 2.2, step: 0.1 },
  proseSize: { min: 14, max: 22, step: 0.5 },
  proseLh: { min: 1.5, max: 2.4, step: 0.05 },
} as const

export interface FontPreset { label: string; value: string }

export const CODE_FONTS: FontPreset[] = [
  { label: 'JetBrains Mono（内嵌）', value: DEFAULT_SETTINGS.codeFont },
  { label: 'Cascadia Code', value: `'Cascadia Code', ${CODE_FONT_FALLBACK}` },
  { label: 'Consolas', value: `Consolas, ${CODE_FONT_FALLBACK}` },
  { label: 'SF Mono', value: `'SF Mono', ${CODE_FONT_FALLBACK}` },
]

export const PROSE_FONTS: FontPreset[] = [
  { label: '系统衬线（Songti / Noto Serif）', value: DEFAULT_SETTINGS.proseFont },
  { label: '系统黑体（PingFang / Noto Sans）', value: `'PingFang SC', 'Noto Sans SC', 'Hiragino Sans GB', sans-serif` },
]

const clampNum = (v: number, b: { min: number; max: number }, fallback: number) =>
  Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : fallback

export function clampSettings(s: Settings): Settings {
  return {
    ...s,
    codeSize: clampNum(s.codeSize, SETTINGS_BOUNDS.codeSize, DEFAULT_SETTINGS.codeSize),
    codeLh: clampNum(s.codeLh, SETTINGS_BOUNDS.codeLh, DEFAULT_SETTINGS.codeLh),
    proseSize: clampNum(s.proseSize, SETTINGS_BOUNDS.proseSize, DEFAULT_SETTINGS.proseSize),
    proseLh: clampNum(s.proseLh, SETTINGS_BOUNDS.proseLh, DEFAULT_SETTINGS.proseLh),
    autosaveRecovery: typeof s.autosaveRecovery === 'boolean' ? s.autosaveRecovery : DEFAULT_SETTINGS.autosaveRecovery,
    previewRandomSeed: typeof s.previewRandomSeed === 'boolean' ? s.previewRandomSeed : DEFAULT_SETTINGS.previewRandomSeed,
    aiChatRetentionDays: clampRetention(s.aiChatRetentionDays),
  }
}

/** 清洗保留天数：null（关闭）保留；有效正整数夹紧到边界；其余回默认。 */
function clampRetention(v: unknown): number | null {
  if (v === null) return null
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
    return Math.min(AI_CHAT_RETENTION_BOUNDS.max, Math.max(AI_CHAT_RETENTION_BOUNDS.min, Math.floor(v)))
  }
  return DEFAULT_SETTINGS.aiChatRetentionDays
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return clampSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* 存储不可用时静默——与现有 theme/view 持久化一致 */
  }
}

export function applySettingsVars(s: Settings): void {
  const root = document.documentElement.style
  root.setProperty('--code-font', s.codeFont)
  root.setProperty('--code-size', `${s.codeSize}px`)
  root.setProperty('--code-lh', `${s.codeLh}`)
  root.setProperty('--prose-font', s.proseFont)
  root.setProperty('--prose-size', `${s.proseSize}px`)
  root.setProperty('--prose-lh', `${s.proseLh}`)
}

/** 剥掉可截断 / 逃逸 CSS 的字符，防样式注入。 */
export function sanitizeFontName(input: string): string {
  return input.replace(/[;{}<>]/g, '')
}
