import { describe, it, expect } from 'vitest'
import { computeExternalSync } from './rescan'
import type { LoadedProject, Manifest, ProjectFileEntry } from './gateway'
import type { FileBuffer } from '../state/editorReducer'

const MF: Manifest = { name: 'p', version: '1.0.0', engine: '0.0.0', entry: 'main.kin' }
const buf = (path: string, source: string, savedSource = source): FileBuffer =>
  ({ path, source, savedSource, dirty: source !== savedSource })
const entry = (path: string, source?: string): ProjectFileEntry =>
  ({ path, isKin: path.endsWith('.kin'), ...(source !== undefined ? { source } : {}) })
const snap = (files: ProjectFileEntry[], emptyDirs: string[] = [], manifest = MF): LoadedProject =>
  ({ dir: '/p', manifest, manifestFile: 'p.kiw', files, emptyDirs })
const st = (files: FileBuffer[], entries: ProjectFileEntry[], emptyDirs: string[] = []) => ({
  files: Object.fromEntries(files.map((f) => [f.path, f])),
  entries, emptyDirs, manifest: MF, manifestFile: 'p.kiw',
})

describe('computeExternalSync', () => {
  it('零变化（含自写回环：磁盘 == savedSource）→ null', () => {
    const s = st([buf('main.kin', 'A')], [entry('main.kin', 'A')])
    expect(computeExternalSync(s, snap([entry('main.kin', 'A')]))).toBeNull()
  })

  it('干净缓冲 + 磁盘变化 → reloaded', () => {
    const s = st([buf('main.kin', 'A')], [entry('main.kin', 'A')])
    const r = computeExternalSync(s, snap([entry('main.kin', 'B')]))!
    expect(r.reloaded).toEqual({ 'main.kin': 'B' })
    expect(r.conflicted).toEqual({})
    expect(r.missingDirty).toEqual([])
  })

  it('脏缓冲 + 磁盘变化 → conflicted', () => {
    const s = st([buf('main.kin', '我改的', 'A')], [entry('main.kin', 'A')])
    const r = computeExternalSync(s, snap([entry('main.kin', 'B')]))!
    expect(r.conflicted).toEqual({ 'main.kin': 'B' })
    expect(r.reloaded).toEqual({})
  })

  it('脏缓冲 + 磁盘变化但与 savedSource 相同 → 无指令（外部改回去了）', () => {
    const s = st([buf('main.kin', '我改的', 'A')], [entry('main.kin', 'A')])
    expect(computeExternalSync(s, snap([entry('main.kin', 'A')]))).toBeNull()
  })

  it('新增文件（文本 / 二进制）→ 有 payload，snapshot 为新真相', () => {
    const s = st([buf('main.kin', 'A')], [entry('main.kin', 'A')])
    const r = computeExternalSync(s, snap([entry('main.kin', 'A'), entry('b.kin', 'B'), entry('img.png')]))!
    expect(r.snapshot.files.map((f) => f.path)).toEqual(['main.kin', 'b.kin', 'img.png'])
    expect(r.reloaded).toEqual({})
  })

  it('删除：干净缓冲不进 missingDirty；脏缓冲进', () => {
    const s = st(
      [buf('a.kin', 'A'), buf('b.kin', '改了', 'B')],
      [entry('a.kin', 'A'), entry('b.kin', 'B')],
    )
    const r = computeExternalSync(s, snap([]))!
    expect(r.missingDirty).toEqual(['b.kin'])
  })

  it('已 missing 的脏缓冲每轮继续进 missingDirty（保持标记）', () => {
    const files = { 'a.kin': { ...buf('a.kin', '改了', 'A'), missing: true } as FileBuffer & { missing?: boolean } }
    const s = { ...st([], [entry('x.kin', 'X')]), files }
    const r = computeExternalSync(s, snap([entry('x.kin', 'X')]))!
    expect(r.missingDirty).toEqual(['a.kin'])
  })

  it('missing 文件在磁盘重现且内容不同 → conflicted（复活即冲突）', () => {
    const files = { 'a.kin': { ...buf('a.kin', '改了', 'A'), missing: true } as FileBuffer & { missing?: boolean } }
    const s = { ...st([], []), files }
    const r = computeExternalSync(s, snap([entry('a.kin', 'B')]))!
    expect(r.conflicted).toEqual({ 'a.kin': 'B' })
    expect(r.missingDirty).toEqual([])
  })

  it('仅空目录变化 → 有 payload', () => {
    const s = st([buf('main.kin', 'A')], [entry('main.kin', 'A')], [])
    const r = computeExternalSync(s, snap([entry('main.kin', 'A')], ['assets']))
    expect(r).not.toBeNull()
  })

  it('仅 manifest 字段变化 → 有 payload', () => {
    const s = st([buf('main.kin', 'A')], [entry('main.kin', 'A')])
    const r = computeExternalSync(s, snap([entry('main.kin', 'A')], [], { ...MF, entry: 'other.kin' }))
    expect(r).not.toBeNull()
  })

  it('二进制仅存在性：同名仍在 → 不构成变化', () => {
    const s = st([buf('main.kin', 'A')], [entry('main.kin', 'A'), entry('img.png')])
    expect(computeExternalSync(s, snap([entry('main.kin', 'A'), entry('img.png')]))).toBeNull()
  })
})
