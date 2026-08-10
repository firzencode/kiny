import { describe, it, expect, beforeEach, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { importKip, listLibrary, openPackage, deleteStory } from './store'
import { openDb, reqDone, STORE_STORIES } from './db'
import type { StoredStory } from './types'

/** 直接读 `stories` 记录里的封面 Blob（listLibrary 只给 objectURL，量不出体积）。 */
async function storedCover(id: string): Promise<Blob | undefined> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_STORIES, 'readonly')
    const s = await reqDone(tx.objectStore(STORE_STORIES).get(id) as IDBRequest<StoredStory | undefined>)
    return s?.coverBlob
  } finally {
    db.close()
  }
}

const MANIFEST = JSON.stringify({
  name: '测试故事', version: '1.0.0', engine: '0.1.0', entry: 'main.kin',
  author: '张三', cover: 'assets/c.png', description: '简介文字',
})
const MAIN = '开场。\n-> END\n'

function kipBytes(manifest = MANIFEST): Uint8Array {
  return zipSync({
    'kiny.json': strToU8(manifest),
    'main.kin': strToU8(MAIN),
    'assets/c.png': new Uint8Array([1, 2, 3]),
  })
}

// 每个用例前清库，避免跨用例数据残留。
beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('kiny-shelf')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

describe('library store', () => {
  it('importKip 落库并返回条目', async () => {
    const item = await importKip(kipBytes())
    expect(item.name).toBe('测试故事')
    expect(item.author).toBe('张三')
    expect(item.description).toBe('简介文字')
    expect(item.version).toBe('1.0.0')
    expect(item.id).toMatch(/[0-9a-f-]{36}/)
  })

  it('坏包（装配失败）→ 抛错、不落库', async () => {
    const bad = zipSync({ 'kiny.json': strToU8('not json'), 'main.kin': strToU8(MAIN) })
    await expect(importKip(bad)).rejects.toThrow()
    expect(await listLibrary()).toHaveLength(0)
  })

  it('listLibrary 按导入时间倒序、封面出 objectURL', async () => {
    // 先在真实时间下生成 zip 字节（fflate 内部也用 Date.now() 写 mtime），再单独 mock 导入时刻的 Date.now，
    // 避免 mock 影响 zipSync 本身（且需 try/finally 保证异常时也 restore，不泄漏到后续用例）。
    const jiaBytes = kipBytes(JSON.stringify({ name: '甲', version: '1.0.0', engine: '0.1.0', entry: 'main.kin', cover: 'assets/c.png' }))
    const yiBytes = kipBytes(JSON.stringify({ name: '乙', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }))
    const nowSpy = vi.spyOn(Date, 'now')
    try {
      nowSpy.mockReturnValue(1000) // 甲
      await importKip(jiaBytes)
      nowSpy.mockReturnValue(2000) // 乙
      await importKip(yiBytes)
    } finally {
      nowSpy.mockRestore()
    }
    const list = await listLibrary()
    expect(list.map((i) => i.name)).toEqual(['乙', '甲']) // 后导入置顶
    const jia = list.find((i) => i.name === '甲')!
    expect(jia.coverUrl).toMatch(/^blob:/)
    expect(list.find((i) => i.name === '乙')!.coverUrl).toBeUndefined() // 无 cover 字段
  })

  it('导入时把封面压成缩略图存 stories，原图仍完整躺在 packages 里', async () => {
    // 桩掉 jsdom 没有的两个浏览器 API，让 makeCoverThumb 真的走到重编码分支。
    const original = new Uint8Array(300_000) // 「大封面」：超体积预算
    const bytes = zipSync({
      'kiny.json': strToU8(MANIFEST),
      'main.kin': strToU8(MAIN),
      'assets/c.png': original,
    })
    globalThis.createImageBitmap = (async () => ({ width: 1600, height: 2400, close: () => {} })) as unknown as typeof createImageBitmap
    globalThis.OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage: () => {} } }
      async convertToBlob() { return new Blob([new Uint8Array(4096)], { type: 'image/webp' }) }
    } as unknown as typeof OffscreenCanvas
    try {
      const item = await importKip(bytes)
      const list = await listLibrary()
      expect(list).toHaveLength(1)
      // 列表侧：拿到的是缩略图（体积远小于原图）
      const thumb = await storedCover(item.id)
      expect(thumb!.size).toBe(4096)
      // 包体侧：原图分毫未动，阅读时照常可用
      const pkg = await openPackage(item.id)
      expect((pkg.assets.get('assets/c.png') as Blob).size).toBe(original.length)
    } finally {
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap
      delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    }
  })

  it('压不出缩略图的环境（无 OffscreenCanvas）→ 照旧存原封面，导入不失败', async () => {
    expect(typeof OffscreenCanvas).toBe('undefined') // 前提：jsdom 无此 API，且上一用例的桩已清干净
    const item = await importKip(kipBytes())
    expect((await storedCover(item.id))!.size).toBe(3) // assets/c.png 的三个字节，原样
  })

  it('openPackage 取回可装配的包', async () => {
    const item = await importKip(kipBytes())
    const pkg = await openPackage(item.id)
    expect(pkg.manifestName).toBe('kiny.json')
    expect(pkg.kinFiles.get('main.kin')).toContain('开场')
    expect(pkg.assets.get('assets/c.png')).toBeInstanceOf(Blob)
  })

  it('openPackage 不存在的 id → 抛错', async () => {
    await expect(openPackage('无此id')).rejects.toThrow()
  })

  it('deleteStory 删除后书架为空、包也取不到', async () => {
    const item = await importKip(kipBytes())
    await deleteStory(item.id)
    expect(await listLibrary()).toHaveLength(0)
    await expect(openPackage(item.id)).rejects.toThrow()
  })
})
