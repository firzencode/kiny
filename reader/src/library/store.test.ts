import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const open = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => open(...a) }))

import { listLibrary, importKip, deleteStory, pickKipFile } from './store'

beforeEach(() => { invoke.mockReset(); open.mockReset() })

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

  it('importKip 用 kipPath 调命令并解析封面', async () => {
    invoke.mockResolvedValue({ id: 'a', dir: '/lib/a', name: '甲', cover: 'assets/c.jpg' })
    const item = await importKip('/downloads/x.kip')
    expect(invoke).toHaveBeenCalledWith('import_kip', { kipPath: '/downloads/x.kip' })
    expect(item.coverUrl).toBeTruthy()
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
