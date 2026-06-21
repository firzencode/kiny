import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles } from './memory'

const manifest = JSON.stringify({ name: '内存项目', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })

describe('loadProjectFromFiles', () => {
  it('合法 manifest 文本 + 内存文件 → ok，含 entry/meta/files', () => {
    const files = new Map([['main.kin', '=== A ===\n正文\n-> END']])
    const r = loadProjectFromFiles(manifest, files)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entry).toBe('main.kin')
      expect(r.meta.name).toBe('内存项目')
      expect(r.files.some((f) => f.path === 'main.kin')).toBe(true)
    }
  })
  it('坏 JSON manifest 文本 → manifest 错', () => {
    const r = loadProjectFromFiles('{ 坏 json', new Map([['main.kin', '-> END']]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatchObject({ kind: 'manifest', file: 'kiny.json' })
  })
  it('manifest 缺字段 → manifest 错', () => {
    const r = loadProjectFromFiles('{ "name": "x" }', new Map([['main.kin', '-> END']]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.kind).toBe('manifest')
  })
})
