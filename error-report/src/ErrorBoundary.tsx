import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import { logErrorEntry } from './errorLog'
import { ErrorDetailsDialog } from './ErrorDetailsDialog'

interface Props {
  children: ReactNode
  /** 自定义致命错误兜底页；不传则用内置全屏 fallback。 */
  fallback?: (error: Error) => ReactNode
}
interface State {
  error: Error | null
}

/** React 致命渲染错误兜底：捕获 → 记日志 → 全屏 fallback（含「查看详情」「重新加载」）。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logErrorEntry({
      source: 'react-boundary',
      message: error.message,
      stack: error.stack,
      context: info.componentStack ?? undefined,
    })
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error)
      return <DefaultFallback error={this.state.error} />
    }
    return this.props.children
  }
}

function DefaultFallback({ error }: { error: Error }) {
  const [showDetails, setShowDetails] = useState(false)
  return (
    <div className="error-report-fatal" style={wrap}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>应用遇到错误</h1>
        <p style={{ opacity: 0.8, marginBottom: 4 }}>很抱歉，发生了一个无法恢复的错误。</p>
        <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 20 }}>{error.message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button style={primaryBtn} onClick={() => setShowDetails(true)}>
            查看详情
          </button>
          <button style={btn} onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      </div>
      <ErrorDetailsDialog open={showDetails} onClose={() => setShowDetails(false)} />
    </div>
  )
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#1e1e1e',
  color: '#e6e6e6',
  padding: 24,
}
const btn: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}
const primaryBtn: React.CSSProperties = { ...btn, background: '#3b82f6', borderColor: '#3b82f6', color: '#fff' }
