import { describe, it, expect } from 'vitest'
import {
  emptyDraftStore, parseDraftStore, hashSource, reconcileProjectDrafts,
  clearProjectDrafts, detectRecoverable, pruneProjects, MAX_DRAFT_PROJECTS,
  type DraftStore, type DraftBuffer,
} from './drafts'

const buf = (path: string, source: string, savedSource: string, dirty: boolean): DraftBuffer =>
  ({ path, source, savedSource, dirty })

describe('drafts: parse / hash', () => {
  it('parseDraftStore 空 / null / 损坏 / 版本不符 → 空 store', () => {
    expect(parseDraftStore(null)).toEqual(emptyDraftStore())
    expect(parseDraftStore('')).toEqual(emptyDraftStore())
    expect(parseDraftStore('{ not json')).toEqual(emptyDraftStore())
    expect(parseDraftStore(JSON.stringify({ version: 2, projects: {} }))).toEqual(emptyDraftStore())
    expect(parseDraftStore(JSON.stringify({ version: 1 }))).toEqual(emptyDraftStore())
  })

  it('parseDraftStore 合法往返', () => {
    const s: DraftStore = { version: 1, projects: { '/p': { 'a.kin': { source: 'x', base: 'b', ts: 1 } } } }
    expect(parseDraftStore(JSON.stringify(s))).toEqual(s)
  })

  it('hashSource 同内容同值、异内容多半异值', () => {
    expect(hashSource('hello')).toBe(hashSource('hello'))
    expect(hashSource('hello')).not.toBe(hashSource('world'))
    expect(hashSource('')).toBe(hashSource(''))
  })
})

describe('drafts: reconcileProjectDrafts', () => {
  it('脏缓冲写草稿、base = hash(savedSource)', () => {
    const s = reconcileProjectDrafts(emptyDraftStore(), '/p', [buf('a.kin', 'new', 'old', true)], 100)
    expect(s.projects['/p']['a.kin']).toEqual({ source: 'new', base: hashSource('old'), ts: 100 })
  })

  it('非脏缓冲不写（= 删除其草稿）', () => {
    let s = reconcileProjectDrafts(emptyDraftStore(), '/p', [buf('a.kin', 'new', 'old', true)], 100)
    // 保存后变非脏 → 再对账应删掉草稿、项目键也清空
    s = reconcileProjectDrafts(s, '/p', [buf('a.kin', 'new', 'new', false)], 200)
    expect(s.projects['/p']).toBeUndefined()
  })

  it('混合脏 / 非脏：只留脏的', () => {
    const s = reconcileProjectDrafts(emptyDraftStore(), '/p', [
      buf('a.kin', 'A2', 'A1', true),
      buf('b.kin', 'B1', 'B1', false),
    ], 100)
    expect(Object.keys(s.projects['/p'])).toEqual(['a.kin'])
  })

  it('内容未变时沿用旧时间戳（定时兜底不刷新 ts）', () => {
    let s = reconcileProjectDrafts(emptyDraftStore(), '/p', [buf('a.kin', 'new', 'old', true)], 100)
    s = reconcileProjectDrafts(s, '/p', [buf('a.kin', 'new', 'old', true)], 999)
    expect(s.projects['/p']['a.kin'].ts).toBe(100)
  })

  it('内容变化刷新 ts', () => {
    let s = reconcileProjectDrafts(emptyDraftStore(), '/p', [buf('a.kin', 'new', 'old', true)], 100)
    s = reconcileProjectDrafts(s, '/p', [buf('a.kin', 'newer', 'old', true)], 999)
    expect(s.projects['/p']['a.kin'].ts).toBe(999)
  })

  it('不影响其他项目的草稿', () => {
    let s = reconcileProjectDrafts(emptyDraftStore(), '/p1', [buf('a.kin', 'A', 'x', true)], 100)
    s = reconcileProjectDrafts(s, '/p2', [buf('b.kin', 'B', 'y', true)], 200)
    expect(s.projects['/p1']['a.kin'].source).toBe('A')
    expect(s.projects['/p2']['b.kin'].source).toBe('B')
  })
})

describe('drafts: pruneProjects / LRU', () => {
  it('超上限淘汰最旧项目（按最新草稿时间）', () => {
    let s = emptyDraftStore()
    for (let i = 0; i < MAX_DRAFT_PROJECTS + 3; i++) {
      s = reconcileProjectDrafts(s, `/p${i}`, [buf('a.kin', 'x', 'y', true)], i + 1)
    }
    expect(Object.keys(s.projects).length).toBe(MAX_DRAFT_PROJECTS)
    expect(s.projects['/p0']).toBeUndefined() // 最旧被淘汰
    expect(s.projects['/p1']).toBeUndefined()
    expect(s.projects['/p2']).toBeUndefined()
    expect(s.projects[`/p${MAX_DRAFT_PROJECTS + 2}`]).toBeDefined() // 最新保留
  })

  it('pruneProjects 未超上限原样返回', () => {
    const s = reconcileProjectDrafts(emptyDraftStore(), '/p', [buf('a.kin', 'x', 'y', true)], 1)
    expect(pruneProjects(s)).toBe(s)
  })
})

describe('drafts: clearProjectDrafts', () => {
  it('清空指定项目、保留其余', () => {
    let s = reconcileProjectDrafts(emptyDraftStore(), '/p1', [buf('a.kin', 'A', 'x', true)], 1)
    s = reconcileProjectDrafts(s, '/p2', [buf('b.kin', 'B', 'y', true)], 2)
    s = clearProjectDrafts(s, '/p1')
    expect(s.projects['/p1']).toBeUndefined()
    expect(s.projects['/p2']).toBeDefined()
  })

  it('清空不存在的项目：原样返回', () => {
    const s = emptyDraftStore()
    expect(clearProjectDrafts(s, '/nope')).toBe(s)
  })
})

describe('drafts: detectRecoverable', () => {
  const store = (recs: Record<string, { source: string; base: string }>): DraftStore => ({
    version: 1,
    projects: { '/p': Object.fromEntries(Object.entries(recs).map(([k, v]) => [k, { ...v, ts: 1 }])) },
  })

  it('草稿内容 = 磁盘 → 已保存，跳过', () => {
    const s = store({ 'a.kin': { source: 'same', base: hashSource('same') } })
    expect(detectRecoverable(s, '/p', [{ path: 'a.kin', source: 'same' }])).toEqual([])
  })

  it('草稿内容 ≠ 磁盘且 base 匹配磁盘 → ok', () => {
    const s = store({ 'a.kin': { source: 'draft', base: hashSource('disk') } })
    expect(detectRecoverable(s, '/p', [{ path: 'a.kin', source: 'disk' }]))
      .toEqual([{ path: 'a.kin', source: 'draft', status: 'ok' }])
  })

  it('磁盘自写草稿后被外部改过（base ≠ hash 磁盘）→ diskChanged', () => {
    const s = store({ 'a.kin': { source: 'draft', base: hashSource('old-disk') } })
    expect(detectRecoverable(s, '/p', [{ path: 'a.kin', source: 'new-disk' }]))
      .toEqual([{ path: 'a.kin', source: 'draft', status: 'diskChanged' }])
  })

  it('磁盘无此文件（删 / 改名）→ missing', () => {
    const s = store({ 'gone.kin': { source: 'draft', base: hashSource('x') } })
    expect(detectRecoverable(s, '/p', [{ path: 'a.kin', source: 'disk' }]))
      .toEqual([{ path: 'gone.kin', source: 'draft', status: 'missing' }])
  })

  it('无草稿项目 → 空', () => {
    expect(detectRecoverable(emptyDraftStore(), '/p', [{ path: 'a.kin', source: 'x' }])).toEqual([])
  })

  it('多项按 path 升序', () => {
    const s = store({
      'b.kin': { source: 'B', base: hashSource('xb') },
      'a.kin': { source: 'A', base: hashSource('xa') },
    })
    const items = detectRecoverable(s, '/p', [{ path: 'a.kin', source: 'xa-changed' }, { path: 'b.kin', source: 'xb-changed' }])
    expect(items.map((i) => i.path)).toEqual(['a.kin', 'b.kin'])
  })
})
