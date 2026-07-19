import type { CSSProperties } from 'react'
import type { RichSpan } from '@kiny/engine'

/**
 * RichSpan 富文本样式 → 内联 CSS。打字中（RevealingLine 逐字 span）与定格后（RichText 整段）
 * 共用这一份映射，保证同一 span 两阶段的 DOM 样式完全一致——宿主定制不会在「打字→定格」的
 * 瞬间闪变（此前定格用 `<strong>/<em>` 语义标签、打字用 fontWeight 等内联样式，宿主对标签的
 * 定制只命中定格态，切换时视觉抖动，Q2）。
 */
export function spanStyle(s: Extract<RichSpan, { text: string }>): CSSProperties {
  const style: CSSProperties = {}
  if (s.bold) style.fontWeight = 700
  if (s.italic) style.fontStyle = 'italic'
  const deco: string[] = []
  if (s.underline) deco.push('underline')
  if (s.strike) deco.push('line-through')
  if (deco.length) style.textDecoration = deco.join(' ')
  if (s.color) style.color = s.color
  if (s.size) style.fontSize = `${s.size}em`
  return style
}
