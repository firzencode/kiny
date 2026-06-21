import { describe, it, expect } from 'vitest'
import { assembleProject } from './assemble'
import type { KinyMeta } from './types'

const meta: KinyMeta = { name: 'T', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }

describe('assembleProject', () => {
  it('多文件收集并按 path 字典序排序', () => {
    const files = new Map([
      ['main.kin', '=== A ===\n正文\n-> END'],
      ['chapters/b.kin', '=== B ===\n正文\n-> END'],
    ])
    const r = assembleProject(meta, files)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.files.map((f) => f.path)).toEqual(['chapters/b.kin', 'main.kin'])
  })
  it('entry 不在文件集 → manifest 错', () => {
    const r = assembleProject(meta, new Map([['other.kin', '=== A ===\n-> END']]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatchObject({ kind: 'manifest', file: 'kiny.json' })
  })
  it('解析错透传 file+line', () => {
    const r = assembleProject(meta, new Map([['main.kin', '=== A ===\n你有{gold 金币']])) // 未闭合插值
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatchObject({ kind: 'parse', file: 'main.kin' })
  })
  it('成功时 entry 原样返回', () => {
    const r = assembleProject(meta, new Map([['main.kin', '=== A ===\n-> END']]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.entry).toBe('main.kin')
  })
})
