import type { InlineStyle, PauseKind } from '../parser/ast'
import { sameStyle } from '../parser/style'

export type { PauseKind }

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
      /** 字体族名（`<font=名>`）；宿主渲染时补回退栈。 */
      font?: string
      /** 语义样式类名（`<class=名>`）；宿主渲染加 `kin-` 前缀。 */
      classes?: string[]
      /**
       * 本段前有一处 `<pause>` 停顿标记（纯呈现层的段边界，不是引擎暂停点）：
       * `true` = 点击档（揭示到此停住、等读者点击）；正整数 = 毫秒档（停满时长自动续显）。
       */
      pauseBefore?: PauseKind
    }
  | { kind: 'break'; pauseBefore?: PauseKind }

/** 由文本 + 内联样式快照造一个文本 span：仅落生效的样式键（无样式则只剩 text）。 */
export function makeTextSpan(text: string, style?: InlineStyle, pauseBefore?: PauseKind): RichSpan {
  const span: Extract<RichSpan, { text: string }> = { text }
  if (pauseBefore) span.pauseBefore = pauseBefore
  if (style) {
    if (style.bold) span.bold = true
    if (style.italic) span.italic = true
    if (style.underline) span.underline = true
    if (style.strike) span.strike = true
    if (style.color !== undefined) span.color = style.color
    if (style.size !== undefined) span.size = style.size
    if (style.font !== undefined) span.font = style.font
    // 数组拷贝：span 随 log 长期留存，不与解析期栈快照共享可变引用。
    if (style.classes && style.classes.length > 0) span.classes = [...style.classes]
  }
  return span
}

function isBreak(s: RichSpan): s is { kind: 'break' } {
  return 'kind' in s && s.kind === 'break'
}

/**
 * 合并相邻、同样式的文本 span（break 是边界）；保持纯文本恒为单 span，确保向后兼容。
 * `pauseBefore` 同样是硬边界——带停顿标记的段绝不与前段合并（两档同等对待，看字段是否存在），
 * 否则标记位置就丢了（glue 拼行经 mergeSpans 走同一函数，故拼接处的标记也保留）。
 */
export function coalesce(spans: RichSpan[]): RichSpan[] {
  const out: RichSpan[] = []
  for (const s of spans) {
    if (isBreak(s)) {
      out.push(s)
      continue
    }
    const prev = out.length > 0 ? out[out.length - 1]! : null
    if (prev && !isBreak(prev) && !s.pauseBefore && sameStyle(prev, s)) {
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

/**
 * 两串 span 是否完全等价（文本 + 样式 + 段边界）。`@panel` 活模板据此判断「重估后有无变化」，
 * 无变化就不发事件——变量没动时不打扰宿主。
 * 停顿按**值**比（`true` ≠ `500`）：两档若被判等，档位就在拼行 / 快照比对里丢了。
 */
export function sameSpans(a: RichSpan[] | null, b: RichSpan[]): boolean {
  if (a === null || a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    if (isBreak(x) || isBreak(y)) return isBreak(x) && isBreak(y) && x.pauseBefore === y.pauseBefore
    return x.text === y.text && x.pauseBefore === y.pauseBefore && sameStyle(x, y)
  })
}

/** 富文本降级为纯文本（终端 / 可达性标签 / 测试断言用）：break → 换行，文本顺序拼接。 */
export function plainText(spans: RichSpan[]): string {
  return spans.map((s) => (isBreak(s) ? '\n' : s.text)).join('')
}
