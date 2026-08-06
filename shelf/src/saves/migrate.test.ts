import { describe, it, expect, beforeEach } from 'vitest'
import { emptyHost } from '@kiny/player'
import { migrateLocalStorageSaves } from './migrate'
import { listSaves, writeSave } from './store'
import { AUTO_SAVE_ID, type SaveRecord } from './types'

/** 造一条**旧版**（localStorage 时代）存档：没有 storyId 字段，它编在键名里。 */
function oldSave(id: string, kind: SaveRecord['kind'] = 'manual', label = 'x') {
  return {
    id, kind,
    snapshot: { fingerprint: 'fp' },
    play: { log: [], host: emptyHost, choices: [], input: null, ended: false, error: null },
    meta: { timestamp: 1, label },
  }
}
const putOld = (storyId: string, id: string, kind: SaveRecord['kind'] = 'manual', label = 'x') =>
  localStorage.setItem(`kiny-shelf-save:${storyId}:${id}`, JSON.stringify(oldSave(id, kind, label)))

const savePrefixKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('kiny-shelf-save:'))

beforeEach(async () => {
  localStorage.clear()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('kiny-shelf')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

describe('migrateLocalStorageSaves', () => {
  it('旧档搬进 IndexedDB，storyId 从键名补进记录，源键被删', async () => {
    putOld('book', AUTO_SAVE_ID, 'auto', '续读点')
    putOld('book', 'm1', 'manual', '手动档')

    const r = await migrateLocalStorageSaves()
    expect(r).toEqual({ moved: 2, dropped: 0, skipped: 0, failed: 0 })

    const list = await listSaves('book')
    expect(list.map((s) => s.id).sort()).toEqual([AUTO_SAVE_ID, 'm1'])
    expect(list.every((s) => s.storyId === 'book')).toBe(true) // storyId 已归位到记录里
    expect(savePrefixKeys()).toHaveLength(0) // 源键清空
  })

  it('多本书各归各位', async () => {
    putOld('a', 'x')
    putOld('b', 'y')
    await migrateLocalStorageSaves()
    expect((await listSaves('a')).map((s) => s.id)).toEqual(['x'])
    expect((await listSaves('b')).map((s) => s.id)).toEqual(['y'])
  })

  it('幂等：重复跑无副作用（判据就是「还有没有该前缀的键」，不需额外标记）', async () => {
    putOld('book', 'm1')
    await migrateLocalStorageSaves()
    const second = await migrateLocalStorageSaves()
    expect(second).toEqual({ moved: 0, dropped: 0, skipped: 0, failed: 0 })
    expect(await listSaves('book')).toHaveLength(1) // 没被搬成两条
  })

  it('损坏 / 形状非法的旧条目直接丢弃，不搬进新库', async () => {
    localStorage.setItem('kiny-shelf-save:book:broken', '{不是合法JSON')
    localStorage.setItem('kiny-shelf-save:book:shapeless', JSON.stringify({ id: 'shapeless' })) // 缺 snapshot/play/meta
    putOld('book', 'good')

    const r = await migrateLocalStorageSaves()
    expect(r.moved).toBe(1)
    expect(r.dropped).toBe(2)
    expect((await listSaves('book')).map((s) => s.id)).toEqual(['good'])
    expect(savePrefixKeys()).toHaveLength(0) // 坏数据也清掉，不留着每次启动重试
  })

  it('不碰前缀之外的 localStorage 键', async () => {
    localStorage.setItem('unrelated', 'keep-me')
    putOld('book', 'm1')
    await migrateLocalStorageSaves()
    expect(localStorage.getItem('unrelated')).toBe('keep-me')
  })

  it('写入失败 → 源键保留、下次启动续搬（绝不出现「源已删、目标没写进去」）', async () => {
    putOld('book', 'm1')
    const realIDB = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { open: () => { throw new DOMException('denied', 'SecurityError') } },
      configurable: true, writable: true,
    })
    const r = await migrateLocalStorageSaves()
    Object.defineProperty(globalThis, 'indexedDB', { value: realIDB, configurable: true, writable: true })

    expect(r).toEqual({ moved: 0, dropped: 0, skipped: 0, failed: 1 })
    expect(savePrefixKeys()).toHaveLength(1) // 源还在

    const retry = await migrateLocalStorageSaves() // 下次启动续搬
    expect(retry.moved).toBe(1)
    expect((await listSaves('book')).map((s) => s.id)).toEqual(['m1'])
  })

  it('目标已存在 → 跳过不覆盖、只清源键（回归：残留旧档盖掉已推进的新进度）', async () => {
    // 场景：前次迁移已 commit、但在 removeItem 之前被中断（关标签页 / removeItem 失败），
    // 源键残留；此后读者一路读到第十章、auto 档被推进。这次启动绝不能拿第一章盖回去。
    await writeSave('book', { ...oldSave(AUTO_SAVE_ID, 'auto', '第十章'), storyId: 'book' } as unknown as SaveRecord)
    putOld('book', AUTO_SAVE_ID, 'auto', '第一章')

    const r = await migrateLocalStorageSaves()
    expect(r).toEqual({ moved: 0, dropped: 0, skipped: 1, failed: 0 })

    const [rec] = await listSaves('book')
    expect(rec!.meta.label).toBe('第十章') // 库里的新进度原封不动
    expect(savePrefixKeys()).toHaveLength(0) // 源键这次清掉，不再每次启动重试
  })

  it('保留 play / meta 内容，不只是搬个壳', async () => {
    putOld('book', 'm1', 'manual', '第三章 · 雨夜')
    await migrateLocalStorageSaves()
    const [rec] = await listSaves('book')
    expect(rec!.meta.label).toBe('第三章 · 雨夜')
    expect(rec!.kind).toBe('manual')
  })
})
