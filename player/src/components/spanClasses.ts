import type { RichSpan } from '@kiny/engine'

/**
 * 作品 class 的渲染前缀。作者写 `<class=whisper>` → DOM 上是 `kin-whisper`，
 * 机制上杜绝与 player 内部 class（`.narration` `.choice` …）相撞。
 */
const CLASS_PREFIX = 'kin-'

/** 类名数组 → className 字符串；无类名返回 undefined（不产出空 class 属性）。 */
export function spanClassName(classes: string[] | undefined): string | undefined {
  if (!classes || classes.length === 0) return undefined
  return classes.map((c) => CLASS_PREFIX + c).join(' ')
}

function isText(s: RichSpan): s is Extract<RichSpan, { text: string }> {
  return 'text' in s
}

/**
 * 行级 class 提升（spec「两档自动适配」）：某 class 覆盖**整行**（该行全部文本段都带它）时，
 * 提到行容器 `.narration` 上——作者的块级样式（背景 / 边框 / 内边距）才完整可用；
 * 只包句中片段的 class 留在 span 上做局部样式。break 段不算内容，不参与判定。
 * 无可提升时原样返回入参数组（免无谓重建，React 引用稳定）。
 */
export function liftLineClasses(spans: RichSpan[]): { lineClasses: string[]; spans: RichSpan[] } {
  const texts = spans.filter(isText)
  if (texts.length === 0) return { lineClasses: [], spans }
  const first = texts[0]!.classes
  if (!first || first.length === 0) return { lineClasses: [], spans }
  const lineClasses = first.filter((c) => texts.every((s) => s.classes?.includes(c)))
  if (lineClasses.length === 0) return { lineClasses, spans }
  const stripped = spans.map((s) => {
    if (!isText(s) || !s.classes) return s
    const rest = s.classes.filter((c) => !lineClasses.includes(c))
    const { classes: _drop, ...others } = s
    return rest.length > 0 ? { ...others, classes: rest } : others
  })
  return { lineClasses, spans: stripped }
}
