import { logErrorEntry } from './errorLog'
import { configureErrorReport, type ReportMeta } from './meta'

let dispose: (() => void) | null = null

/**
 * 注册全局未捕获错误处理：`window.onerror` + `window.onunhandledrejection` → 入库落盘。
 * 启动即调一次；可顺带传入应用元信息（appName / appVersion）。
 *
 * **幂等**：重复调用不会叠加监听器（返回同一个 dispose）——StrictMode 双跑 effect / 多处初始化
 * 时不再重复入库同一错误。返回 dispose 函数，调用即摘除监听器（测试清理 / 主动卸载用）。
 */
export function installGlobalHandlers(meta?: Partial<ReportMeta>): () => void {
  if (meta) configureErrorReport(meta)
  if (dispose) return dispose

  const onError = (ev: ErrorEvent) => {
    const err = ev.error as Error | undefined
    logErrorEntry({
      source: 'global-onerror',
      message: ev.message || (err ? err.message : 'unknown error'),
      stack: err?.stack,
    })
  }
  const onRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason as unknown
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : String(reason)
    logErrorEntry({
      source: 'unhandled-rejection',
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  dispose = () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    dispose = null
  }
  return dispose
}
