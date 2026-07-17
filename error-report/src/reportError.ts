import { logErrorEntry, type ErrorSource } from './errorLog'

/**
 * 操作错误统一入口：把现有 `catch` 里的错误记进日志，返回供 toast 用的简短 message。
 * source 用 `operation:<名>`（如 `operation:importKip`）标注入口。
 */
export function reportError(err: unknown, source: ErrorSource = 'operation:unknown'): string {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  logErrorEntry({ source, message, stack })
  return message
}
