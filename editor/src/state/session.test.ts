import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SESSION_KEY, MAX_PROJECTS, loadSession, saveSession, resolveSession,
} from './session'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveSession / loadSession 往返', () => {
  it('写入后读回相同 openTabs / activeFile，并带 ts', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    saveSession('/p', ['a.kin', 'b.kin'], 'b.kin')
    const s = loadSession('/p')
    expect(s).toEqual({ openTabs: ['a.kin', 'b.kin'], activeFile: 'b.kin', ts: 1000 })
  })

  it('openTabs 为空也照写（用户主动关光 tab）', () => {
    saveSession('/p', [], null)
    expect(loadSession('/p')).toMatchObject({ openTabs: [], activeFile: null })
  })

  it('不同项目互不干扰', () => {
    saveSession('/p1', ['x.kin'], 'x.kin')
    saveSession('/p2', ['y.kin'], 'y.kin')
    expect(loadSession('/p1')!.openTabs).toEqual(['x.kin'])
    expect(loadSession('/p2')!.openTabs).toEqual(['y.kin'])
  })

  it('同项目再写覆盖旧值', () => {
    saveSession('/p', ['a.kin'], 'a.kin')
    saveSession('/p', ['a.kin', 'b.kin'], 'a.kin')
    expect(loadSession('/p')!.openTabs).toEqual(['a.kin', 'b.kin'])
  })
})

describe('loadSession 降级', () => {
  it('从没存过的项目 → null', () => {
    expect(loadSession('/never')).toBeNull()
  })

  it('损坏 JSON → null', () => {
    localStorage.setItem(SESSION_KEY, '{ not json')
    expect(loadSession('/p')).toBeNull()
  })

  it('缺 key → null', () => {
    expect(loadSession('/p')).toBeNull()
  })

  it('版本不符 → null', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ version: 999, projects: { '/p': { openTabs: ['a.kin'], activeFile: 'a.kin', ts: 1 } } }))
    expect(loadSession('/p')).toBeNull()
  })
})

describe('LRU 上限', () => {
  it(`写入超过 ${MAX_PROJECTS} 个项目后淘汰最旧、总数为上限`, () => {
    let t = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++t)
    for (let i = 0; i < MAX_PROJECTS; i++) saveSession(`/p${i}`, [`${i}.kin`], `${i}.kin`)
    // 此刻 /p0 最旧。再写一个新项目，应淘汰 /p0。
    saveSession('/new', ['n.kin'], 'n.kin')
    const store = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(Object.keys(store.projects)).toHaveLength(MAX_PROJECTS)
    expect(loadSession('/p0')).toBeNull()
    expect(loadSession('/new')!.openTabs).toEqual(['n.kin'])
  })

  it('重写已有项目刷新其 ts，不被当成最旧淘汰', () => {
    let t = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++t)
    for (let i = 0; i < MAX_PROJECTS; i++) saveSession(`/p${i}`, [`${i}.kin`], `${i}.kin`)
    saveSession('/p0', ['refreshed.kin'], 'refreshed.kin') // 刷新 /p0 → 现在 /p1 最旧
    saveSession('/new', ['n.kin'], 'n.kin')
    expect(loadSession('/p0')!.openTabs).toEqual(['refreshed.kin'])
    expect(loadSession('/p1')).toBeNull()
  })
})

describe('resolveSession 降级', () => {
  const valid = new Set(['main.kin', 'a.kin', 'b.kin'])

  it('全部有效 → 原样恢复', () => {
    const saved = { openTabs: ['a.kin', 'b.kin'], activeFile: 'b.kin', ts: 1 }
    expect(resolveSession(saved, valid, 'main.kin')).toEqual({ openTabs: ['a.kin', 'b.kin'], activeFile: 'b.kin' })
  })

  it('部分文件失效 → 过滤失效项，保留其余', () => {
    const saved = { openTabs: ['a.kin', 'gone.kin', 'b.kin'], activeFile: 'b.kin', ts: 1 }
    expect(resolveSession(saved, valid, 'main.kin')).toEqual({ openTabs: ['a.kin', 'b.kin'], activeFile: 'b.kin' })
  })

  it('activeFile 失效 → 降级到过滤后首个 tab', () => {
    const saved = { openTabs: ['a.kin', 'b.kin'], activeFile: 'gone.kin', ts: 1 }
    expect(resolveSession(saved, valid, 'main.kin')).toEqual({ openTabs: ['a.kin', 'b.kin'], activeFile: 'a.kin' })
  })

  it('全部失效 + 有 entry → 回退只开入口', () => {
    const saved = { openTabs: ['gone1.kin', 'gone2.kin'], activeFile: 'gone1.kin', ts: 1 }
    expect(resolveSession(saved, valid, 'main.kin')).toEqual({ openTabs: ['main.kin'], activeFile: 'main.kin' })
  })

  it('全部失效 + 无 entry → 空', () => {
    const saved = { openTabs: ['gone.kin'], activeFile: 'gone.kin', ts: 1 }
    expect(resolveSession(saved, valid, null)).toEqual({ openTabs: [], activeFile: null })
  })

  it('saved 为 null → 走兜底回退入口', () => {
    expect(resolveSession(null, valid, 'main.kin')).toEqual({ openTabs: ['main.kin'], activeFile: 'main.kin' })
  })

  it('entry 本身已失效（不在 validPaths）→ 不强开入口，返回空', () => {
    const saved = { openTabs: ['gone.kin'], activeFile: 'gone.kin', ts: 1 }
    expect(resolveSession(saved, valid, 'deleted-entry.kin')).toEqual({ openTabs: [], activeFile: null })
  })
})
