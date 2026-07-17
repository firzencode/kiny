import { describe, it, expect, vi, beforeEach } from 'vitest'

const { logErrorMock } = vi.hoisted(() => ({ logErrorMock: vi.fn((_msg: string) => Promise.resolve()) }))
vi.mock('@tauri-apps/plugin-log', () => ({ error: logErrorMock }))

import {
  logErrorEntry,
  getErrorEntries,
  clearErrorEntries,
  formatEntry,
  MAX_ENTRIES,
} from './errorLog'

beforeEach(() => {
  clearErrorEntries()
  logErrorMock.mockClear()
})

describe('errorLog ring buffer', () => {
  it('记一条进 buffer 并返回带时间戳的条目', () => {
    const e = logErrorEntry({ source: 'operation:test', message: '炸了' })
    expect(e.level).toBe('error')
    expect(e.source).toBe('operation:test')
    expect(e.message).toBe('炸了')
    expect(e.ts).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(getErrorEntries()).toHaveLength(1)
  })

  it('上限 50：超出淘汰最旧，保留最近 50 条', () => {
    for (let i = 0; i < MAX_ENTRIES + 10; i++) logErrorEntry({ source: 'operation:n', message: `e${i}` })
    const entries = getErrorEntries()
    expect(entries).toHaveLength(MAX_ENTRIES)
    expect(entries[0]!.message).toBe('e10') // e0..e9 已被淘汰
    expect(entries[entries.length - 1]!.message).toBe(`e${MAX_ENTRIES + 9}`)
  })

  it('每条转发到 plugin-log 的 error()', () => {
    logErrorEntry({ source: 'global-onerror', message: 'x', stack: 'at foo' })
    expect(logErrorMock).toHaveBeenCalledTimes(1)
    expect(logErrorMock.mock.calls[0]![0]).toContain('[global-onerror] x')
    expect(logErrorMock.mock.calls[0]![0]).toContain('at foo')
  })
})

describe('formatEntry', () => {
  it('含来源、message、stack、context', () => {
    const s = formatEntry({
      ts: 't',
      level: 'error',
      source: 'operation:importKip',
      message: '导入失败',
      stack: 'at a\nat b',
      context: 'file=x.kip',
    })
    expect(s).toContain('[operation:importKip] 导入失败')
    expect(s).toContain('at a')
    expect(s).toContain('context: file=x.kip')
  })

  it('plugin-log 抛错时不影响入库（非 Tauri 环境优雅降级）', () => {
    logErrorMock.mockImplementationOnce(() => {
      throw new Error('no tauri')
    })
    expect(() => logErrorEntry({ source: 'operation:x', message: 'y' })).not.toThrow()
    expect(getErrorEntries()).toHaveLength(1)
  })
})
