import { Component, type ReactNode } from 'react'

/**
 * 极简错误兜底：引擎 / 渲染层的未预期异常（非 RuntimeError 的 storyDriver 重抛等）
 * 若不拦截会让 React 卸载整树——导出的独立网页面向终端读者，白屏且无任何诊断是最差失败形态。
 * 不依赖 @kiny/error-report（那是 Tauri 宿主专用），纯 React 类组件自包含。
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-status app-error">
          <p>页面出错了，刷新页面可从头重试。</p>
          <p>{String(this.state.error.message || this.state.error)}</p>
        </div>
      )
    }
    return this.props.children
  }
}
