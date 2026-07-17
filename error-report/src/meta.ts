/** 应用元信息：随每条错误与「复制详情」文本记录，便于按版本/平台定位。 */
export interface ReportMeta {
  appName: string
  appVersion: string
}

let meta: ReportMeta = { appName: 'Kiny', appVersion: '0.0.0' }

/** 启动时由宿主应用配置一次（appName / appVersion 由各 app 注入）。 */
export function configureErrorReport(m: Partial<ReportMeta>): void {
  meta = { ...meta, ...m }
}

export function getReportMeta(): ReportMeta {
  return meta
}

/** webview 里能拿到的 OS / 浏览器标识（不引入额外 Tauri 插件）。 */
export function osLabel(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent) return navigator.userAgent
  return 'unknown'
}
