import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const open = vi.fn()
const readFile = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => open(...a) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...a: unknown[]) => readFile(...a) }))

import { listLibrary, importKip, deleteStory, pickKipFile } from './store'

beforeEach(() => { invoke.mockReset(); open.mockReset(); readFile.mockReset() })

describe('library/store', () => {
  it('listLibrary 把 cover 解析为 asset URL，无 cover 则不解析', async () => {
    invoke.mockResolvedValue([
      { id: 'a', dir: '/lib/a', name: '甲', cover: 'assets/c.jpg' },
      { id: 'b', dir: '/lib/b', name: '乙' },
    ])
    const items = await listLibrary()
    expect(invoke).toHaveBeenCalledWith('list_library')
    expect(items[0].coverUrl).toContain('asset://localhost/')
    expect(items[0].coverUrl).toContain('a%2Fassets')
    expect(items[1].coverUrl).toBeUndefined()
  })

  it('importKip 读字节后经原始请求体 + 文件名 header 调字节入口并解析封面', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]) // 任意字节（PK..）
    readFile.mockResolvedValue(bytes)
    invoke.mockResolvedValue({ id: 'a', dir: '/lib/a', name: '甲', cover: 'assets/c.jpg' })
    const item = await importKip('/downloads/雾港.kip')
    expect(readFile).toHaveBeenCalledWith('/downloads/雾港.kip')
    expect(invoke).toHaveBeenCalledWith('import_kip_bytes', bytes, {
      headers: { 'x-kip-filename': encodeURIComponent('雾港.kip') },
    })
    expect(item.coverUrl).toBeTruthy()
  })

  it('importKip 对 content:// URI 走原生 android-fs 入口 import_kip_uri（plugin-fs 在 Android 读不了 content://）', async () => {
    invoke.mockResolvedValue({ id: 'b', dir: '/lib/b', name: '乙' })
    const uri = 'content://com.android.providers/document/123'
    const item = await importKip(uri)
    // content:// 不经 plugin-fs readFile（Tauri #9083 读不了），改由 Rust 侧 android-fs 读字节。
    expect(readFile).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('import_kip_uri', { uri })
    expect(item.name).toBe('乙')
  })

  it('deleteStory 透传 id', async () => {
    invoke.mockResolvedValue(undefined)
    await deleteStory('a')
    expect(invoke).toHaveBeenCalledWith('delete_story', { id: 'a' })
  })

  it('pickKipFile 选到返回路径，取消返回 null', async () => {
    open.mockResolvedValueOnce('/d/x.kip')
    expect(await pickKipFile()).toBe('/d/x.kip')
    open.mockResolvedValueOnce(null)
    expect(await pickKipFile()).toBeNull()
  })
})
