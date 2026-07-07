import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SESSION_KEY, MAX_PROJECTS, loadSession, saveSession, resolveSession,
  listRecentProjects, removeSession,
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

  it('传入 name 时持久化项目名', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    saveSession('/p', ['a.kin'], 'a.kin', '雾港之夜')
    expect(loadSession('/p')).toEqual({ openTabs: ['a.kin'], activeFile: 'a.kin', ts: 1000, name: '雾港之夜' })
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

describe('listRecentProjects', () => {
  it('空存储 → 空数组', () => {
    expect(listRecentProjects()).toEqual([])
  })

  it('按 ts 降序返回（最近打开在前），带 name', () => {
    let t = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++t)
    saveSession('/a', ['a.kin'], 'a.kin', '甲')
    saveSession('/b', ['b.kin'], 'b.kin', '乙')
    saveSession('/c', ['c.kin'], 'c.kin', '丙')
    expect(listRecentProjects()).toEqual([
      { dir: '/c', name: '丙', ts: 3 },
      { dir: '/b', name: '乙', ts: 2 },
      { dir: '/a', name: '甲', ts: 1 },
    ])
  })

  it('缺 name 的旧数据 → 用目录 basename 降级（兼容 / 与 \\ 分隔）', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1,
      projects: {
        'D:\\stories\\fog-harbor': { openTabs: [], activeFile: null, ts: 2 },
        '/home/u/star': { openTabs: [], activeFile: null, ts: 1 },
      },
    }))
    expect(listRecentProjects()).toEqual([
      { dir: 'D:\\stories\\fog-harbor', name: 'fog-harbor', ts: 2 },
      { dir: '/home/u/star', name: 'star', ts: 1 },
    ])
  })

  it('损坏存储 → 空数组', () => {
    localStorage.setItem(SESSION_KEY, '{ not json')
    expect(listRecentProjects()).toEqual([])
  })
})

describe('removeSession', () => {
  it('删除指定项目并落盘，其余保留', () => {
    saveSession('/a', ['a.kin'], 'a.kin', '甲')
    saveSession('/b', ['b.kin'], 'b.kin', '乙')
    removeSession('/a')
    expect(loadSession('/a')).toBeNull()
    expect(loadSession('/b')!.openTabs).toEqual(['b.kin'])
  })

  it('删不存在的项目 → 无副作用', () => {
    saveSession('/b', ['b.kin'], 'b.kin', '乙')
    removeSession('/never')
    expect(loadSession('/b')!.openTabs).toEqual(['b.kin'])
  })

  it('存储不可用时静默不抛', () => {
    saveSession('/a', ['a.kin'], 'a.kin', '甲')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => removeSession('/a')).not.toThrow()
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
