import { Fragment, type ReactNode } from 'react'
import type { RichSpan } from '@kiny/engine'

function isBreak(s: RichSpan): s is { kind: 'break' } {
  return 'kind' in s && s.kind === 'break'
}

/** 把单个富文本 span 渲染为 React 节点：break → <br>；文本 span 按样式逐层包裹。 */
function renderSpan(span: RichSpan, key: number): ReactNode {
  if (isBreak(span)) return <br key={key} />
  let node: ReactNode = span.text
  if (span.color !== undefined || span.size !== undefined) {
    const style: { color?: string; fontSize?: string } = {}
    if (span.color !== undefined) style.color = span.color
    if (span.size !== undefined) style.fontSize = `${span.size}em`
    node = <span style={style}>{node}</span>
  }
  if (span.underline) node = <u>{node}</u>
  if (span.strike) node = <s>{node}</s>
  if (span.italic) node = <em>{node}</em>
  if (span.bold) node = <strong>{node}</strong>
  return <Fragment key={key}>{node}</Fragment>
}

/** 渲染一串富文本 spans（正文叙事与选项文本共用，确保两处样式一致）。 */
export function RichText({ spans }: { spans: RichSpan[] }) {
  return <>{spans.map((s, i) => renderSpan(s, i))}</>
}
