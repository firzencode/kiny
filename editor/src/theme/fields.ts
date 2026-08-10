import { mixWithText, parseColor } from './color'

/**
 * 主题 GUI 呈现哪些 token、各用什么控件。
 *
 * 原则：**默认 css 里能调的，GUI 里都能调**——`player/src/styles.css` 的 `:root` 有多少个
 * `--kiny-*`，这里就有多少个字段（有单测双向比对，谁多谁少都红）。「文件里有、编辑器还会
 * 写进去、却不给调」是最别扭的组合，故不留缺口。
 *
 * 分组按作者关心的先后排：配色 / 排印在前且常驻；其余归「进阶」，默认收起——不懂 css 的
 * 作者一眼只看见六项常用的，想深入的人展开即可。
 */

/** 数值型字段的滑杆范围与单位。 */
export interface NumericSpec {
  min: number
  max: number
  step: number
  /** 写回时附加的单位（行高是纯数字，故为空串）。 */
  unit: string
}

interface FieldBase {
  name: string
  label: string
  group: string
  /** 一句话说明这个 token 管什么（控件旁的小字）。 */
  hint?: string
}

export type ThemeField =
  /** `alpha` 为真时给透明度滑杆——半透明是这些 token 的常态，不给就只能退化成文本框。 */
  | (FieldBase & { kind: 'color'; alpha?: true })
  | (FieldBase & { kind: 'font' })
  | (FieldBase & { kind: 'numeric'; spec: NumericSpec })

/** 常驻分组（永远展开）；其余分组归「进阶」，默认收起。 */
export const PRIMARY_GROUPS = ['配色', '排印']

export const THEME_FIELDS: ThemeField[] = [
  // ── 常驻 ────────────────────────────────────────────────────────────────
  { name: '--kiny-page-bg', label: '页面底色', group: '配色', kind: 'color' },
  { name: '--kiny-text', label: '正文文字色', group: '配色', kind: 'color' },
  { name: '--kiny-prose-font', label: '正文字体', group: '排印', kind: 'font' },
  { name: '--kiny-prose-size', label: '正文字号', group: '排印', kind: 'numeric', spec: { min: 0.8, max: 1.6, step: 0.05, unit: 'rem' } },
  { name: '--kiny-prose-line-height', label: '行高', group: '排印', kind: 'numeric', spec: { min: 1.2, max: 2.4, step: 0.05, unit: '' } },
  { name: '--kiny-content-max-width', label: '阅读栏宽', group: '排印', kind: 'numeric', spec: { min: 480, max: 1000, step: 10, unit: 'px' } },

  // ── 进阶 ────────────────────────────────────────────────────────────────
  { name: '--kiny-control-bg', label: '按钮底色', group: '选项按钮', kind: 'color', alpha: true },
  { name: '--kiny-control-bg-hover', label: '按钮悬停底色', group: '选项按钮', kind: 'color', alpha: true },
  { name: '--kiny-control-text', label: '按钮文字色', group: '选项按钮', kind: 'color' },
  { name: '--kiny-control-border', label: '按钮描边', group: '选项按钮', kind: 'color', alpha: true, hint: '选项是读者唯一能点的东西，描边太淡会看不见' },

  { name: '--kiny-panel-bg', label: '面板底色', group: '固定区域', kind: 'color', alpha: true, hint: '默认全透明，不遮氛围底图' },
  { name: '--kiny-panel-text', label: '面板文字色', group: '固定区域', kind: 'color', alpha: true, hint: '不设则跟随正文色（降一档）' },
  { name: '--kiny-panel-border', label: '面板发丝线', group: '固定区域', kind: 'color', alpha: true, hint: '不设则跟随正文色' },

  { name: '--kiny-bg-overlay', label: '底图遮罩', group: '其它', kind: 'color', alpha: true, hint: '盖在氛围底图上，保证正文读得清' },
  { name: '--kiny-accent', label: '强调色', group: '其它', kind: 'color', alpha: true, hint: '「点击继续」等提示' },
  { name: '--kiny-error', label: '错误文字色', group: '其它', kind: 'color' },
]

/** GUI 覆盖的 token 名集合。 */
export const FIELD_NAMES = new Set(THEME_FIELDS.map((f) => f.name))

/**
 * 各字段在 player 里的默认值（文件中缺该 token 时控件的呈现基准）。
 * 面板文字 / 发丝线是**推导值**，见 `defaultValueOf`——这里存的是 player 原样的函数式，
 * 供防漂移单测逐字比对。
 */
export const FIELD_DEFAULTS: Record<string, string> = {
  '--kiny-page-bg': '#0d1117',
  '--kiny-text': '#e8e8e8',
  '--kiny-prose-font': 'system-ui, "Noto Sans SC", sans-serif',
  '--kiny-prose-size': '1.05rem',
  '--kiny-prose-line-height': '1.9',
  '--kiny-content-max-width': '680px',
  '--kiny-bg-overlay': 'rgba(10, 14, 20, .55)',
  '--kiny-control-bg': 'rgba(255, 255, 255, .06)',
  '--kiny-control-bg-hover': 'rgba(255, 255, 255, .14)',
  '--kiny-control-text': '#fff',
  '--kiny-control-border': 'rgba(255, 255, 255, .35)',
  '--kiny-accent': 'rgba(255, 255, 255, .8)',
  '--kiny-error': '#ff8585',
  '--kiny-panel-bg': 'transparent',
  '--kiny-panel-text': 'color-mix(in srgb, var(--kiny-text) 62%, transparent)',
  '--kiny-panel-border': 'color-mix(in srgb, var(--kiny-text) 12%, transparent)',
}

/** 面板类 token 在 player 里的推导比例（`color-mix(... var(--kiny-text) N%, transparent)`）。 */
const DERIVED_FROM_TEXT: Record<string, number> = {
  '--kiny-panel-text': 0.62,
  '--kiny-panel-border': 0.12,
}

/**
 * 文件里缺该 token 时，控件该显示什么。面板类由**当前生效的正文色**推导出实际颜色
 * （而非把 `color-mix(...)` 那串函数式塞进取色器）；其余直接取 player 默认值。
 *
 * 只是「显示」——不动控件就不写回，作者与正文色的联动因此不会被无声切断。
 */
export function defaultValueOf(name: string, effectiveText: string): string {
  const ratio = DERIVED_FROM_TEXT[name]
  if (ratio !== undefined) {
    const derived = mixWithText(effectiveText, ratio)
    if (derived !== null) return derived
  }
  return FIELD_DEFAULTS[name] ?? ''
}

/** 字体下拉里的通用族（项目内字体列在其前）。value 即写回的完整族串。 */
export const GENERIC_FONTS: { label: string; value: string }[] = [
  { label: '系统默认', value: 'system-ui, "Noto Sans SC", sans-serif' },
  { label: '衬线（宋体一类）', value: 'serif' },
  { label: '无衬线（黑体一类）', value: 'sans-serif' },
  { label: '等宽', value: 'monospace' },
]

/** `#rgb` / `#rrggbb` → 归一小写 `#rrggbb`；带透明度或表达不了则 null。 */
export function toHexColor(value: string): string | null {
  const c = parseColor(value)
  return c && c.alpha >= 1 ? c.hex : null
}

/** 取数值型字段的数字部分（单位须与 spec 一致）；表达不了（`clamp(...)` 等）则 null。 */
export function toNumber(value: string, unit: string): number | null {
  const v = value.trim()
  const body = unit === '' ? v : v.endsWith(unit) ? v.slice(0, -unit.length) : null
  if (body === null) return null
  if (!/^-?\d+(\.\d+)?$/.test(body.trim())) return null
  return Number(body)
}
