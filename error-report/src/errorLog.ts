import { error as pluginLogError } from '@tauri-apps/plugin-log'

/** 错误来源标签：让开发者一眼看出错误入口（§3）。 */
export type ErrorSource =
  | 'global-onerror'
  | 'unhandled-rejection'
  | 'react-boundary'
  | `operation:${string}`

/** 一条错误记录（内存 ring buffer 与落盘共用的结构）。 */
export interface ErrorEntry {
  /** ISO 时间戳。 */
  ts: string
  level: 'error'
  source: ErrorSource
  message: string
  stack?: string
  /** 额外上下文（如 React componentStack、操作参数摘要）。 */
  context?: string
}

const MAX_ENTRIES = 50
const buffer: ErrorEntry[] = []

/** 单条压成一行（含 stack / context）转发给 plugin-log；plugin-log 自带时间戳与落盘。 */
export function formatEntry(e: ErrorEntry): string {
  let out = `[${e.source}] ${e.message}`
  if (e.stack) out += `\n${e.stack}`
  if (e.context) out += `\ncontext: ${e.context}`
  return out
}

/** 转发到 Tauri plugin-log 的 error()；非 Tauri 环境（测试 / 浏览器）静默降级。 */
function forward(e: ErrorEntry): void {
  try {
    const r = pluginLogError(formatEntry(e)) as unknown as { catch?: (f: () => void) => void }
    r?.catch?.(() => {})
  } catch {
    /* 非 Tauri 环境：忽略，仅留内存 buffer */
  }
}

/** 记一条错误：进内存 ring buffer（上限 50，超出淘汰最旧）+ 转发落盘。返回所记条目。 */
export function logErrorEntry(input: {
  source: ErrorSource
  message: string
  stack?: string
  context?: string
}): ErrorEntry {
  const entry: ErrorEntry = {
    ts: new Date().toISOString(),
    level: 'error',
    source: input.source,
    message: input.message,
    stack: input.stack,
    context: input.context,
  }
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.shift()
  forward(entry)
  return entry
}

/** 最近的错误条目（最旧→最新），副本。 */
export function getErrorEntries(): ErrorEntry[] {
  return [...buffer]
}

/** 清空内存 buffer（测试用）。 */
export function clearErrorEntries(): void {
  buffer.length = 0
}

export { MAX_ENTRIES }
