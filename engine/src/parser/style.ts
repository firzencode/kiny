import type { InlineStyle } from './ast'

/**
 * 两个内联样式是否等价（可合并相邻同样式片段）。两侧都缺省视为等价；一有一无视为不同。
 * 解析层（scanInline 归并 literal 段）与运行层（coalesce 归并富文本 span）共用同一判据。
 */
export function sameStyle(a: InlineStyle | undefined, b: InlineStyle | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    a.color === b.color &&
    a.size === b.size
  )
}
