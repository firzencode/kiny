// @kiny/error-report —— editor / reader 共享的运行时错误收集（捕获 → 落本地日志 → UI 取证/反馈）。
export { configureErrorReport, getReportMeta, osLabel, type ReportMeta } from './meta'
export {
  logErrorEntry,
  getErrorEntries,
  clearErrorEntries,
  formatEntry,
  MAX_ENTRIES,
  type ErrorEntry,
  type ErrorSource,
} from './errorLog'
export { reportError } from './reportError'
export { installGlobalHandlers } from './installGlobalHandlers'
export { buildCopyText, githubIssueUrl, GITHUB_NEW_ISSUE_URL, FEEDBACK_FORM_URL } from './format'
export { ErrorBoundary } from './ErrorBoundary'
export { ErrorDetailsDialog } from './ErrorDetailsDialog'
