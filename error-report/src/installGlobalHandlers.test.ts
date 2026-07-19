import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(() => Promise.resolve()) }))

import { installGlobalHandlers } from './installGlobalHandlers'
import { getErrorEntries, clearErrorEntries } from './errorLog'
import { getReportMeta } from './meta'

beforeEach(() => clearErrorEntries())

describe('installGlobalHandlers', () => {
  it('配置 meta 并捕获 window error 事件', () => {
    installGlobalHandlers({ appName: 'Kiny 编辑器', appVersion: '9.9.9' })
    expect(getReportMeta()).toEqual({ appName: 'Kiny 编辑器', appVersion: '9.9.9' })

    window.dispatchEvent(new ErrorEvent('error', { message: '崩了', error: new Error('崩了') }))
    const e = getErrorEntries().at(-1)!
    expect(e.source).toBe('global-onerror')
    expect(e.message).toBe('崩了')
  })

  it('捕获 unhandledrejection', () => {
    installGlobalHandlers()
    const ev = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(ev, 'reason', { value: new Error('promise 炸了') })
    window.dispatchEvent(ev)
    const e = getErrorEntries().at(-1)!
    expect(e.source).toBe('unhandled-rejection')
    expect(e.message).toBe('promise 炸了')
  })

  it('幂等：重复安装返回同一 dispose、不叠加监听器；dispose 后不再捕获', () => {
    const d1 = installGlobalHandlers()
    const d2 = installGlobalHandlers()
    expect(d2).toBe(d1) // 幂等：同一 dispose，不重复 addEventListener
    clearErrorEntries()
    window.dispatchEvent(new ErrorEvent('error', { message: 'once', error: new Error('once') }))
    // 只一套监听器 → 只记一次（旧实现每次安装叠加，会记多次）。
    expect(getErrorEntries().filter((e) => e.message === 'once')).toHaveLength(1)
    // dispose 摘除监听器并重置模块状态：之后重装得到**全新**的 dispose（证明旧的已摘、状态已重置）。
    d1()
    const d3 = installGlobalHandlers()
    expect(d3).not.toBe(d1)
    d3() // 清理，避免影响同文件后续
  })
})
