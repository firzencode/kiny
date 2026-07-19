import { Fragment, type ReactNode } from 'react'
import type { RichSpan } from '@kiny/engine'
import { spanStyle } from './spanStyle'

function isBreak(s: RichSpan): s is { kind: 'break' } {
  return 'kind' in s && s.kind === 'break'
}

/** 把单个富文本 span 渲染为 React 节点：break → <br>；文本 span 按 spanStyle 的内联样式包裹
 * （与打字中的 RevealingLine 共用同一样式映射，两阶段 DOM 样式一致，Q2）；无样式的纯文本不包裹。 */
function renderSpan(span: RichSpan, key: number): ReactNode {
  if (isBreak(span)) return <br key={key} />
  const style = spanStyle(span)
  if (Object.keys(style).length === 0) return <Fragment key={key}>{span.text}</Fragment>
  return <span key={key} style={style}>{span.text}</span>
}

/** 渲染一串富文本 spans（正文叙事与选项文本共用，确保两处样式一致）。 */
export function RichText({ spans }: { spans: RichSpan[] }) {
  return <>{spans.map((s, i) => renderSpan(s, i))}</>
}
