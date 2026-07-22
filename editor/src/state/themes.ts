/**
 * 编辑器自定义主题（T042）。机制基石：CodeMirror 主题与编辑器 UI 全量走 `var(--x)`（cm/theme.ts），
 * 故只要覆盖白名单 UI 色 token 的 CSS 变量，UI 与代码区同时改观、无需触碰组件。
 * 自定义主题基于暗/亮预设基底，只存改过的变量（overrides），其余继承基底。
 */

export type ThemeBase = 'dark' | 'light'
export type PresetId = 'dark' | 'light' | 'plain'

export interface CustomTheme {
  id: string
  name: string
  base: ThemeBase // 继承基底未覆盖的全部变量
  overrides: Record<string, string> // 仅存改过的白名单变量 → 颜色值
}

/** 可定制的白名单 UI 色 token（分组，供取色面板）。派生变量（--accent-soft/-line）不入，自动跟随 --accent。 */
export const THEME_VAR_GROUPS: { label: string; vars: string[] }[] = [
  { label: '背景层', vars: ['--backdrop', '--bg-0', '--bg-1', '--bg-2', '--bg-3'] },
  { label: '边框', vars: ['--border', '--border-2'] },
  { label: '文字层', vars: ['--text', '--text-dim', '--text-faint'] },
  { label: '强调', vars: ['--accent', '--accent-fg'] },
  { label: '状态色', vars: ['--ok', '--warn', '--err'] },
]
export const THEME_VARS: string[] = THEME_VAR_GROUPS.flatMap((g) => g.vars)
const THEME_VAR_SET = new Set(THEME_VARS)

export const PRESET_IDS: PresetId[] = ['dark', 'light', 'plain']
export const isPresetId = (id: string): id is PresetId => id === 'dark' || id === 'light' || id === 'plain'
export const PRESET_LABEL: Record<PresetId, string> = { dark: '石板墨', light: '象牙稿', plain: '素雪白' }

/**
 * 各预设的明暗性质（驱动 banner 择图 / 自定义主题基底类型）。素雪白（plain）是浅色主题、性质为 light。
 * `ThemeBase` 只 dark/light（自定义主题基底不含 plain）；预设可多于基底，本表把预设归一到明暗二元。
 */
export const PRESET_NATURE: Record<PresetId, ThemeBase> = { dark: 'dark', light: 'light', plain: 'light' }

/**
 * 白名单变量在各预设基底下的值（镜像 styles.css `:root`/`[data-theme='light']`——改 styles.css 白名单
 * 变量时须同步此表）。JS 侧需要它来：渲染取色面板的当前色（未覆盖变量取基底值）、算 WCAG 对比度、
 * 「新建」时以基底为视觉起点。
 */
export const PRESET_VARS: Record<PresetId, Record<string, string>> = {
  dark: {
    '--backdrop': '#0c0e13', '--bg-0': '#16181f', '--bg-1': '#1b1e27', '--bg-2': '#232733', '--bg-3': '#2c3140',
    '--border': '#272b36', '--border-2': '#333949',
    '--text': '#e4e7ee', '--text-dim': '#9aa1b2', '--text-faint': '#5b6273',
    '--accent': '#d2a24c', '--accent-fg': '#1a1407',
    '--ok': '#6fb6a0', '--warn': '#e0b341', '--err': '#e5685c',
  },
  light: {
    '--backdrop': '#cfc9ba', '--bg-0': '#fbfaf6', '--bg-1': '#f1eee5', '--bg-2': '#e7e2d6', '--bg-3': '#e2dbc6',
    '--border': '#ddd7c8', '--border-2': '#cec7b3',
    '--text': '#2b2823', '--text-dim': '#6e695b', '--text-faint': '#a39c8a',
    '--accent': '#9a6e2c', '--accent-fg': '#fbf6ea',
    '--ok': '#3f8a72', '--warn': '#9a7a16', '--err': '#bb4a3f',
  },
  plain: {
    '--backdrop': '#d5d5d8', '--bg-0': '#ffffff', '--bg-1': '#f7f7f8', '--bg-2': '#eeeef1', '--bg-3': '#e4e4e8',
    '--border': '#e7e7ea', '--border-2': '#d5d5da',
    '--text': '#1f2023', '--text-dim': '#64656c', '--text-faint': '#9a9ba3',
    '--accent': '#9a6e2c', '--accent-fg': '#fbf6ea',
    '--ok': '#3c8570', '--warn': '#8a6d12', '--err': '#bb4a3f',
  },
}

const CUSTOM_KEY = 'kiny-editor-custom-themes'
const ACTIVE_KEY = 'kiny-editor-theme' // 沿用现有 key：旧值 'dark'/'light' 天然是合法预设 id，无需迁移

/** 生成稳定唯一 id（crypto.randomUUID，回退时间戳+随机）。 */
export function genThemeId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
  }
}

export function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(isValidCustomTheme)
  } catch {
    return []
  }
}

export function saveCustomThemes(list: CustomTheme[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    /* 存储不可用时静默降级——与现有 theme/view 持久化一致 */
  }
}

export function loadActiveThemeId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || 'dark'
  } catch {
    return 'dark'
  }
}

export function saveActiveThemeId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    /* ignore */
  }
}

function isValidCustomTheme(v: unknown): v is CustomTheme {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    (t.base === 'dark' || t.base === 'light') &&
    t.overrides !== null &&
    typeof t.overrides === 'object'
  )
}

/** 活动主题 id 对应的有效明暗基底（预设按其明暗性质映射，如 plain→light；自定义取其 base；找不到回落 dark）。 */
export function effectiveBase(activeThemeId: string, customThemes: CustomTheme[]): ThemeBase {
  if (isPresetId(activeThemeId)) return PRESET_NATURE[activeThemeId]
  return customThemes.find((t) => t.id === activeThemeId)?.base ?? 'dark'
}

/** 主题各白名单变量的有效值（未覆盖取基底值）。 */
export function effectiveVars(base: ThemeBase, overrides: Record<string, string>): Record<string, string> {
  const out = { ...PRESET_VARS[base] }
  for (const [k, v] of Object.entries(overrides)) if (THEME_VAR_SET.has(k)) out[k] = v
  return out
}

/**
 * 应用主题到根元素（接续 data-theme 机制）：先清掉全部白名单变量的 inline 覆盖（避免跨主题残留），
 * 再按活动主题设 data-theme（预设自身 / 自定义的基底）与 inline 覆盖。活动 id 指向已删除的自定义主题
 * → 回落 dark 预设（无从得知其原基底）。
 */
export function applyTheme(
  activeThemeId: string,
  customThemes: CustomTheme[],
  root: HTMLElement = document.documentElement,
): void {
  for (const v of THEME_VARS) root.style.removeProperty(v)
  if (isPresetId(activeThemeId)) {
    root.dataset.theme = activeThemeId
    return
  }
  const t = customThemes.find((ct) => ct.id === activeThemeId)
  if (!t) {
    root.dataset.theme = 'dark'
    return
  }
  root.dataset.theme = t.base
  for (const [k, val] of Object.entries(t.overrides)) {
    if (THEME_VAR_SET.has(k)) root.style.setProperty(k, val)
  }
}

/** 基于基底新建一份自定义主题（overrides 空 = 视觉等同基底）。名字在现有列表里去重。 */
export function newCustomTheme(base: ThemeBase, existing: CustomTheme[]): CustomTheme {
  return { id: genThemeId(), name: dedupeName(`${PRESET_LABEL[base]}·自定义`, existing), base, overrides: {} }
}

/** 同名加数字后缀去重（「名」→「名 2」→「名 3」…）。 */
export function dedupeName(name: string, existing: CustomTheme[]): string {
  const names = new Set(existing.map((t) => t.name))
  if (!names.has(name)) return name
  for (let i = 2; ; i++) {
    const candidate = `${name} ${i}`
    if (!names.has(candidate)) return candidate
  }
}

// ---- 颜色 / WCAG 对比度 ----

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

/** WCAG 对比度（仅支持 hex；非 hex 返回 null，调用方跳过提示）。 */
export function contrastRatio(fg: string, bg: string): number | null {
  const a = hexToRgb(fg)
  const b = hexToRgb(bg)
  if (!a || !b) return null
  const l1 = relLuminance(a)
  const l2 = relLuminance(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** 关键前景/背景对：低于阈值给非阻塞提示。threshold 4.5=正文 AA，3=大字/图形 AA。 */
export const CONTRAST_PAIRS: { fg: string; bg: string; label: string; threshold: number }[] = [
  { fg: '--text', bg: '--bg-0', label: '正文 / 主背景', threshold: 4.5 },
  { fg: '--text-dim', bg: '--bg-1', label: '次要文字 / 面板背景', threshold: 4.5 },
  { fg: '--accent-fg', bg: '--accent', label: '强调前景 / 强调色', threshold: 3 },
]

export interface ContrastWarning {
  label: string
  ratio: number
  threshold: number
}

/** 对给定有效变量集算各关键对对比度，返回低于阈值的（非阻塞提示用）。 */
export function contrastWarnings(vars: Record<string, string>): ContrastWarning[] {
  const out: ContrastWarning[] = []
  for (const p of CONTRAST_PAIRS) {
    const ratio = contrastRatio(vars[p.fg] ?? '', vars[p.bg] ?? '')
    if (ratio !== null && ratio < p.threshold) out.push({ label: p.label, ratio, threshold: p.threshold })
  }
  return out
}

// ---- 导入 / 导出 ----

/** 导出为 JSON（含 name/base/overrides，不含 id——导入时重分配，避免撞车）。 */
export function exportTheme(t: CustomTheme): string {
  return JSON.stringify({ name: t.name, base: t.base, overrides: t.overrides }, null, 2)
}

export function isValidColor(v: string): boolean {
  if (typeof v !== 'string') return false
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim())) return true
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(v.trim())) return true
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', v)
  } catch {
    /* ignore */
  }
  return false
}

export type ImportResult =
  | { ok: true; name: string; base: ThemeBase; overrides: Record<string, string>; skipped: number }
  | { ok: false; error: string }

/**
 * 解析导入的主题 JSON：base 非法拒绝整份；overrides 逐键校验（白名单内 + 合法颜色），非法项跳过并计数；
 * 未知/白名单外键忽略（前向兼容）。非 JSON / 结构完全不符 → 可识别的错误提示，不炸。
 */
export function parseImportedTheme(json: string): ImportResult {
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    return { ok: false, error: '主题文件无法识别（不是有效 JSON）。' }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: '主题文件无法识别。' }
  const o = obj as Record<string, unknown>
  if (o.base !== 'dark' && o.base !== 'light') {
    return { ok: false, error: '主题文件缺少有效的基底（base 须为 dark 或 light）。' }
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '导入的主题'
  const overrides: Record<string, string> = {}
  let skipped = 0
  const rawOv = o.overrides && typeof o.overrides === 'object' ? (o.overrides as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(rawOv)) {
    if (!THEME_VAR_SET.has(k)) continue // 未知/白名单外键：忽略（前向兼容）
    if (typeof v !== 'string' || !isValidColor(v)) {
      skipped++ // 白名单内但值非法 → 跳过并计数
      continue
    }
    overrides[k] = v
  }
  return { ok: true, name, base: o.base, overrides, skipped }
}
