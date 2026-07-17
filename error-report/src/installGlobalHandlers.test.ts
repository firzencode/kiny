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
})
