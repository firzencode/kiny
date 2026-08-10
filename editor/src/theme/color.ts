/**
 * 主题 GUI 的颜色解析与序列化。
 *
 * 换肤 token 里**半透明是常态**（选项按钮底色、描边、氛围底图遮罩、面板文字都靠 alpha
 * 融进页面底色），故颜色控件必须带透明度，不能只认六位十六进制——否则这些字段一律退化成
 * 文本框，等于把「不写 css 也能换肤」这条承诺在最需要的地方收回。
 *
 * 认不出的形态（`color-mix()`、CSS 具名色、`var()`）返回 null，由控件退化为文本输入：
 * **绝不猜**，猜错就是把作者的值改成别的颜色。
 */

export interface ParsedColor {
  /** 归一的小写 `#rrggbb`（取色器要的形态）。 */
  hex: string
  /** 0–1。 */
  alpha: number
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/
const HEX6 = /^#[0-9a-f]{6}$/
const HEX8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/** 解析颜色值；表达不了的形态返回 null。 */
export function parseColor(value: string): ParsedColor | null {
  const v = value.trim().toLowerCase()
  if (v === 'transparent') return { hex: '#000000', alpha: 0 }

  const h3 = HEX3.exec(v)
  if (h3) return { hex: `#${h3[1]}${h3[1]}${h3[2]}${h3[2]}${h3[3]}${h3[3]}`, alpha: 1 }
  if (HEX6.test(v)) return { hex: v, alpha: 1 }
  // 八位十六进制的 alpha 是 0–255，取两位小数即可无损往返（`80` → .5，写回仍是 rgba(...)）
  const h8 = HEX8.exec(v)
  if (h8) return { hex: `#${h8[1]}`, alpha: Math.round((parseInt(h8[2], 16) / 255) * 100) / 100 }

  const m = RGB.exec(v)
  if (m) {
    // `rgba(...)` 少了 alpha 就不是这个函数该猜的事——按 null 交给文本输入
    if (v.startsWith('rgba') && m[4] === undefined) return null
    const alpha = m[4] === undefined ? 1 : Number(m[4])
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null
    return { hex: `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`, alpha }
  }
  return null
}

/**
 * 序列化回 css 值：不透明写六位十六进制（作者手写时最常见的形态）、全透明写 `transparent`、
 * 其余写 `rgba(...)`。小数不带前导 0，与 player 既有写法一致。
 */
export function formatColor(hex: string, alpha: number): string {
  // 先按两位小数定档**再**分流：否则 .999 会走到 rgba 分支、写出 `rgba(…, 1)`；
  // 非数（NaN）按不透明处理——绝不把 `rgba(…, NaN)` 这种语法错误写进作者的文件。
  const a = Number.isFinite(alpha) ? Math.round(alpha * 100) / 100 : 1
  if (a >= 1) return hex
  if (a <= 0) return 'transparent'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${String(a).replace(/^0\./, '.')})`
}

/**
 * 面板类 token 的推导默认值：player 里写作 `color-mix(in srgb, var(--kiny-text) N%, transparent)`，
 * 等价于「正文色 + N% 不透明度」。GUI 据此显示**实际生效的颜色**而非一串函数式。
 * 正文色本身表达不了时返回 null。
 */
export function mixWithText(textValue: string, ratio: number): string | null {
  const base = parseColor(textValue)
  if (!base) return null
  return formatColor(base.hex, base.alpha * ratio)
}
