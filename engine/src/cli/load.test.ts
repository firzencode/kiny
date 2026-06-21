import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadProject } from './load'

const fx = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

describe('loadProject', () => {
  it('合法项目 → ok，含解析后的文件与 entry', () => {
    const r = loadProject(fx('ok'))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entry).toBe('main.kin')
      expect(r.meta.name).toBe('测试项目')
      expect(r.files.some((f) => f.path === 'main.kin')).toBe(true)
    }
  })
  it('缺 kiny.json → io 错', () => {
    const r = loadProject(fx('no-manifest'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.kind).toBe('io')
  })
  it('坏 JSON → manifest 错', () => {
    const r = loadProject(fx('bad-json'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.kind).toBe('manifest')
  })
})
