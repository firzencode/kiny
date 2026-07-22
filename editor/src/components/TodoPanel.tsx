import { type TodoItem, groupTodosByFile } from '../todo/scanTodos'

/** 项目内路径取文件名（末段）。 */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * 左栏「待办」面板：汇总项目脚本里的 TODO/FIXME，按文件分组、点击跳转。纯展示，扫描在 App 层完成。
 * 结构仿 Outline，复用 .outline-head/.collapse-btn/.onode 等类语言；外层 .todo 走「让位」flex（窗口
 * 变矮时优先让位、自身列表内部滚动，守节点栏恒可见的布局不变量）。
 */
export function TodoPanel({
  todos,
  onJump,
  collapsed,
  onToggleCollapse,
}: {
  todos: TodoItem[]
  onJump: (path: string, line: number) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const groups = groupTodosByFile(todos)
  return (
    <nav className={'todo' + (collapsed ? ' collapsed' : '')} aria-label="待办">
      <div className="outline-head">
        <button
          className={'collapse-btn' + (collapsed ? ' collapsed' : '')}
          aria-label={collapsed ? '展开待办' : '折叠待办'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <span className="outline-title">待办</span>
        <span className="outline-tag">{todos.length}</span>
      </div>
      {!collapsed && (todos.length === 0 ? (
        <div className="outline-empty">暂无待办</div>
      ) : (
        <div className="todo-list">
          {groups.map((g) => (
            <div key={g.path} className="todo-group">
              <button className="todo-group-head" title={g.path} onClick={() => onJump(g.path, g.items[0]!.line)}>
                <span className="todo-group-name">{fileName(g.path)}</span>
                <span className="todo-group-count">{g.items.length}</span>
              </button>
              <ul className="outline-list todo-items">
                {g.items.map((it) => (
                  <li key={it.line} className="onode todo-item" onClick={() => onJump(it.path, it.line)}>
                    <span className={'todo-badge ' + it.tag.toLowerCase()}>{it.tag}</span>
                    <span className="todo-text">{it.text || '（无描述）'}</span>
                    <span className="todo-line">{it.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </nav>
  )
}
