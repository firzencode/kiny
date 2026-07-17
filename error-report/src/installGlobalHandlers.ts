import { logErrorEntry } from './errorLog'
import { configureErrorReport, type ReportMeta } from './meta'

/**
 * 注册全局未捕获错误处理：`window.onerror` + `window.onunhandledrejection` → 入库落盘。
 * 启动即调一次；可顺带传入应用元信息（appName / appVersion）。
 */
export function installGlobalHandlers(meta?: Partial<ReportMeta>): void {
  if (meta) configureErrorReport(meta)

  window.addEventListener('error', (ev: ErrorEvent) => {
    const err = ev.error as Error | undefined
    logErrorEntry({
      source: 'global-onerror',
      message: ev.message || (err ? err.message : 'unknown error'),
      stack: err?.stack,
    })
  })

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason as unknown
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : String(reason)
    logErrorEntry({
      source: 'unhandled-rejection',
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })
}
