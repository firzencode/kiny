import type { NodeInfo } from '../syntax/kin'

/**
 * 节点导航（Inky 式 knot navigation）。列出全部 `=== 节点 ===`，点击跳到该行。
 * activeLine 落在某节点区间内时高亮该节点。纯展示，跳转由 onJump(line) 上抛。
 */
export function Outline({
  nodes,
  activeLine,
  onJump,
  collapsed,
  onToggleCollapse,
}: {
  nodes: NodeInfo[]
  activeLine: number
  onJump: (line: number) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const activeName = activeNodeName(nodes, activeLine)
  return (
    <nav className={'outline' + (collapsed ? ' collapsed' : '')} aria-label="节点导航">
      <div className="outline-head">
        <button
          className={'collapse-btn' + (collapsed ? ' collapsed' : '')}
          aria-label={collapsed ? '展开节点' : '折叠节点'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <span className="outline-title">节点</span>
        <span className="outline-tag">{nodes.length}</span>
      </div>
      {!collapsed && (nodes.length === 0 ? (
        <div className="outline-empty">尚无节点</div>
      ) : (
        <ul className="outline-list">
          {nodes.map((n) => (
            <li
              key={n.name + ':' + n.line}
              className={'onode' + (n.name === activeName ? ' active' : '')}
              onClick={() => onJump(n.line)}
            >
              <span className="onode-glyph" aria-hidden>
                <svg width="9" height="9" viewBox="0 0 10 10">
                  <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />
                </svg>
              </span>
              <span className="onode-name">{n.name}</span>
              {n.diverts > 0 && <span className="onode-meta">→{n.diverts}</span>}
            </li>
          ))}
        </ul>
      ))}
    </nav>
  )
}

/** 找出 activeLine 落入的节点名（最后一个 line ≤ activeLine 的节点）。 */
function activeNodeName(nodes: NodeInfo[], activeLine: number): string | null {
  let name: string | null = null
  for (const n of nodes) {
    if (n.line <= activeLine) name = n.name
    else break
  }
  return name
}
