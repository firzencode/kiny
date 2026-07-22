import { describe, it, expect, beforeEach, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { importKip, listLibrary, openPackage, deleteStory } from './store'

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
