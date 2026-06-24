import type { InlineStyle } from '../parser/ast'

/**
 * 一条呈现用的富文本片段：要么是带样式的文本，要么是显式换行。
 * 纯文本（无样式）= `{ text }`，向后兼容；样式键仅在生效时出现。
 */
export type RichSpan =
  | {
      text: string
      bold?: boolean
      italic?: boolean
      underline?: boolean
      strike?: boolean
      color?: string
      size?: number
    }
  | { kind: 'break' }

/** 由文本 + 内联样式快照造一个文本 span：仅落生效的样式键（无样式则只剩 text）。 */
export function makeTextSpan(text: string, style?: InlineStyle): RichSpan {
  const span: Extract<RichSpan, { text: string }> = { text }
  if (style) {
    if (style.bold) span.bold = true
    if (style.italic) span.italic = true
    if (style.underline) span.underline = true
    if (style.strike) span.strike = true
    if (style.color !== undefined) span.color = style.color
    if (style.size !== undefined) span.size = style.size
  }
  return span
}

function isBreak(s: RichSpan): s is { kind: 'break' } {
  return 'kind' in s && s.kind === 'break'
}

/** 两个文本 span 样式是否一致（可合并）。 */
function sameStyle(a: Extract<RichSpan, { text: string }>, b: Extract<RichSpan, { text: string }>): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    a.color === b.color &&
    a.size === b.size
  )
}

/** 合并相邻、同样式的文本 span（break 是边界）；保持纯文本恒为单 span，确保向后兼容。 */
export function coalesce(spans: RichSpan[]): RichSpan[] {
  const out: RichSpan[] = []
  for (const s of spans) {
    if (isBreak(s)) {
      out.push(s)
      continue
    }
    const prev = out.length > 0 ? out[out.length - 1]! : null
    if (prev && !isBreak(prev) && sameStyle(prev, s)) {
      prev.text += s.text
    } else {
      out.push({ ...s })
    }
  }
  return out
}

/** 把两段 span 流拼接并归并边界（用于 glue 跨行 / 选中正文累积）。 */
export function mergeSpans(a: RichSpan[], b: RichSpan[]): RichSpan[] {
  return coalesce([...a, ...b])
}

/** 富文本降级为纯文本（终端 / 可达性标签 / 测试断言用）：break → 换行，文本顺序拼接。 */
export function plainText(spans: RichSpan[]): string {
  return spans.map((s) => (isBreak(s) ? '\n' : s.text)).join('')
}
