import type { Diagnostic } from '@kiny/engine'

/** 诊断列表：点击一条把行号回调给上层（跳到编辑区对应行）。 */
export function DiagnosticsList({
  diagnostics,
  onJump,
  collapsed,
  onToggleCollapse,
}: {
  diagnostics: Diagnostic[]
  onJump: (file: string, line: number) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const errs = diagnostics.filter((d) => d.severity === 'error').length
  return (
    <div className={'diagnostics-panel' + (collapsed ? ' collapsed' : '')}>
      <div className="diagnostics-head">
        <button
          className={'collapse-btn' + (collapsed ? ' collapsed' : '')}
          aria-label={collapsed ? '展开问题面板' : '折叠问题面板'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <span className="diagnostics-tab active">问题</span>
        {diagnostics.length > 0 && (
          <span className={'diagnostics-count' + (errs > 0 ? ' err' : '')}>{diagnostics.length}</span>
        )}
        <span className="diagnostics-spacer" />
        {diagnostics.length === 0 && <span className="diagnostics-ok">语法 + 语义校验通过</span>}
      </div>
      {!collapsed && (diagnostics.length === 0 ? (
        <div className="diagnostics diagnostics-empty">无错误</div>
      ) : (
        <ul className="diagnostics">
          {diagnostics.map((d, i) => (
            <li key={i} className={`diagnostic diagnostic-${d.severity}`} onClick={() => onJump(d.file, d.line)}>
              <span className="diagnostic-sev" aria-hidden>
                {d.severity === 'error' ? sevErr : sevWarn}
              </span>
              <span className="diagnostic-loc">
                {d.file}:{d.line}
              </span>
              <span className="diagnostic-msg">{d.message}</span>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}

const sevErr = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
)
const sevWarn = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
)
