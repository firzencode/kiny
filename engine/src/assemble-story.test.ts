import { describe, it, expect } from 'vitest'
import { assembleFromFiles } from './assemble-story'

const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: '装配测试', version: '2.1.0', engine: '0.1.0', entry: 'main.kin', ...extra })

describe('assembleFromFiles —— 公共装配流水线', () => {
  it('合法项目 → ok，含 story/program/start/seed/meta/warnings', () => {
    const files = new Map([['main.kin', '=== start ===\nHello\n-> END']])
    const r = assembleFromFiles(manifest(), files, { seed: 7 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.story.canContinue).toBe(true)
      expect(r.program).toBeTruthy()
      expect(r.start).toBe('start')
      expect(r.seed).toBe(7)
      expect(r.meta.name).toBe('装配测试')
      expect(r.meta.version).toBe('2.1.0')
      expect(r.warnings).toEqual([])
    }
  })

  it('收集 warning 级诊断（触底无出口），program 仍非空', () => {
    const files = new Map([['main.kin', '=== A ===\n正文没有出口']])
    const r = assembleFromFiles(manifest(), files, { seed: 1 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => w.code === 'fallthrough')).toBe(true)
      expect(r.warnings[0]).toMatchObject({ code: expect.any(String), message: expect.any(String), line: expect.any(Number) })
    }
  })

  it('坏 JSON manifest → ok:false，message 用 manifestName 定位', () => {
    const r = assembleFromFiles('{ 坏 json', new Map([['main.kin', '-> END']]), { manifestName: 'story.kiw' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('story.kiw')
  })

  it('entry 指向不存在的文件 → ok:false', () => {
    const r = assembleFromFiles(manifest({ entry: 'missing.kin' }), new Map([['main.kin', '-> END']]), { seed: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0)
  })

  it('analyze error（未知跳转目标）→ ok:false，message 非空', () => {
    const files = new Map([['main.kin', '=== A ===\n-> Nowhere']])
    const r = assembleFromFiles(manifest(), files, { seed: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0)
  })

  it('无可运行入口（空文件）→ ok:false，「无可运行入口」', () => {
    const r = assembleFromFiles(manifest(), new Map([['main.kin', '']]), { seed: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('无可运行入口')
  })

  it('缺省 seed → 仍 ok，回传一个数值种子', () => {
    const files = new Map([['main.kin', '=== start ===\nHi\n-> END']])
    const r = assembleFromFiles(manifest(), files)
    expect(r.ok).toBe(true)
    if (r.ok) expect(typeof r.seed).toBe('number')
  })
})
