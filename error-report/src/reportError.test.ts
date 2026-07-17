import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(() => Promise.resolve()) }))

import { reportError } from './reportError'
import { getErrorEntries, clearErrorEntries } from './errorLog'

beforeEach(() => clearErrorEntries())

describe('reportError', () => {
  it('Error 入参：返回 message、入库带 stack 与默认 source', () => {
    const msg = reportError(new Error('保存失败'))
    expect(msg).toBe('保存失败')
    const e = getErrorEntries()[0]!
    expect(e.source).toBe('operation:unknown')
    expect(e.message).toBe('保存失败')
    expect(e.stack).toBeTruthy()
  })

  it('非 Error 入参：String 化', () => {
    expect(reportError('坏了', 'operation:importKip')).toBe('坏了')
    expect(getErrorEntries()[0]!.source).toBe('operation:importKip')
  })
})
