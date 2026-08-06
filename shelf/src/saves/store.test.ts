import { describe, it, expect, beforeEach } from 'vitest'
import { emptyHost } from '@kiny/player'
import {
  listSaves, writeSave, writeSaveSerial, readSave, deleteSave,
  storiesWithAutoSave, clearStorySaves, genSaveId,
} from './store'
import { serialize } from './serialQueue'
import { openDb, STORE_SAVES } from '../library/db'
import { AUTO_SAVE_ID, type SaveRecord } from './types'

function mkSave(storyId: string, id: string, kind: SaveRecord['kind'] = 'manual', label = 'x'): SaveRecord {
  return {
    storyId, id, kind,
    snapshot: { fingerprint: 'fp' } as SaveRecord['snapshot'],
    play: { log: [], host: emptyHost, choices: [], input: null, ended: false, error: null },
    meta: { timestamp: 1, label },
  }
}

/** 绕过 store 直接塞一条记录（造形状非法的脏数据用）。 */
async function putRaw(value: unknown): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_SAVES, 'readwrite')
    tx.objectStore(STORE_SAVES).put(value)
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('kiny-shelf')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

describe('saves store（IndexedDB）', () => {
  it('写入 → 读回 → 列举', async () => {
    await writeSave('book', mkSave('book', 'a'))
    await writeSave('book', mkSave('book', 'b'))
    expect((await readSave('book', 'a'))?.id).toBe('a')
    expect((await listSaves('book')).map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('同 id 覆盖而非新增（auto 档持续覆盖靠这条）', async () => {
    await writeSave('book', mkSave('book', AUTO_SAVE_ID, 'auto', '旧'))
    await writeSave('book', mkSave('book', AUTO_SAVE_ID, 'auto', '新'))
    const list = await listSaves('book')
    expect(list).toHaveLength(1)
    expect(list[0]!.meta.label).toBe('新')
  })

  it('readSave 不存在 → null', async () => {
    expect(await readSave('book', 'nope')).toBeNull()
  })

  it('复合主键范围查询只返回该 storyId 的档（不跨书串味）', async () => {
    await writeSave('book', mkSave('book', 'a'))
    await writeSave('other', mkSave('other', 'z'))
    expect((await listSaves('book')).map((s) => s.id)).toEqual(['a'])
    expect((await listSaves('other')).map((s) => s.id)).toEqual(['z'])
  })

  it('storyId 前缀相近的两本书不互相串味（范围上界哨兵有效）', async () => {
    // 'book' 与 'book2'：若上界写成 [storyId+'￿'] 之类的字符串拼接就会把 'book2' 卷进来。
    await writeSave('book', mkSave('book', 'a'))
    await writeSave('book2', mkSave('book2', 'b'))
    expect((await listSaves('book')).map((s) => s.id)).toEqual(['a'])
  })

  it('listSaves 跳过形状非法的记录', async () => {
    await writeSave('book', mkSave('book', 'a'))
    await putRaw({ storyId: 'book', id: 'broken' }) // 缺 snapshot/play/meta
    expect((await listSaves('book')).map((s) => s.id)).toEqual(['a'])
  })

  it('readSave 对形状非法的记录返回 null（不把坏数据交给读档）', async () => {
    await putRaw({ storyId: 'book', id: 'broken' })
    expect(await readSave('book', 'broken')).toBeNull()
  })

  it('writeSave 以参数 storyId 为准（防记录里的 storyId 与之不一致时写错键）', async () => {
    await writeSave('right', { ...mkSave('wrong', 'a') })
    expect((await listSaves('right')).map((s) => s.id)).toEqual(['a'])
    expect(await listSaves('wrong')).toHaveLength(0)
  })

  it('deleteSave 删单条', async () => {
    await writeSave('book', mkSave('book', 'a'))
    await writeSave('book', mkSave('book', 'b'))
    await deleteSave('book', 'a')
    expect((await listSaves('book')).map((s) => s.id)).toEqual(['b'])
  })

  it('storiesWithAutoSave 只认 auto 档', async () => {
    await writeSave('withauto', mkSave('withauto', AUTO_SAVE_ID, 'auto'))
    await writeSave('manualonly', mkSave('manualonly', 'm1'))
    expect(await storiesWithAutoSave()).toEqual(['withauto'])
  })

  it('storiesWithAutoSave 只取键、脏 auto 记录也算可续读（readSave 兜底从头开始）', async () => {
    // 只读键换来的代价：形状非法但 id 为 auto 的脏记录进得了「继续」入口。无害——
    // 真去读时 readSave 的形状校验返回 null，从头播放而非报错。这里把该语义钉住。
    await putRaw({ storyId: 'dirty', id: AUTO_SAVE_ID }) // 缺 snapshot/play/meta
    expect(await storiesWithAutoSave()).toEqual(['dirty'])
    expect(await readSave('dirty', AUTO_SAVE_ID)).toBeNull()
  })

  it('clearStorySaves 与该书的写入同链（删档不插到在飞的写入之前，免留孤儿档）', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    // 占住这本书的写链：模拟删书时仍在飞的一次 auto 写入
    void serialize('book', async () => { await gate; order.push('写') })

    const cleared = clearStorySaves('book').then(() => { order.push('删') })
    await new Promise((r) => setTimeout(r, 20)) // 不入队的实现足够在这段时间里抢先删完
    release()
    await cleared

    expect(order).toEqual(['写', '删'])
  })

  it('clearStorySaves 清一书全部存档、不动别书', async () => {
    await writeSave('book', mkSave('book', AUTO_SAVE_ID, 'auto'))
    await writeSave('book', mkSave('book', 'm1'))
    await writeSave('keep', mkSave('keep', 'k1'))
    await clearStorySaves('book')
    expect(await listSaves('book')).toHaveLength(0)
    expect(await listSaves('keep')).toHaveLength(1)
  })

  it('genSaveId 产 32 位十六进制（无横杠）', () => {
    expect(genSaveId()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('writeSaveSerial —— 走串行队列落库', () => {
  // 队列本身的时序语义（后发起者不抢跑、失败不断链）在 serialQueue.test.ts 里以受控任务断言；
  // 这里只验它确实接上了真实的 IndexedDB 写入。
  it('连发两次同 id 的写：最终态是后发起的那条（auto 档不回退）', async () => {
    const p1 = writeSaveSerial('book', mkSave('book', AUTO_SAVE_ID, 'auto', '先'))
    const p2 = writeSaveSerial('book', mkSave('book', AUTO_SAVE_ID, 'auto', '后'))
    await Promise.all([p1, p2])
    const list = await listSaves('book')
    expect(list).toHaveLength(1)
    expect(list[0]!.meta.label).toBe('后')
  })

  it('不同 story 各自成链，都落到各自的书上', async () => {
    await Promise.all([
      writeSaveSerial('a', mkSave('a', 'x')),
      writeSaveSerial('b', mkSave('b', 'y')),
    ])
    expect((await listSaves('a')).map((s) => s.id)).toEqual(['x'])
    expect((await listSaves('b')).map((s) => s.id)).toEqual(['y'])
  })
})
