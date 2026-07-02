import { describe, it, expect, vi, beforeEach } from 'vitest'

const readTextFile = vi.fn()
const readDir = vi.fn()
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (...a: unknown[]) => readTextFile(...a),
  readDir: (...a: unknown[]) => readDir(...a),
}))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => `asset://localhost/${p}` }))
vi.mock('@tauri-apps/api/path', () => ({ join: async (...p: string[]) => p.join('/') }))

import { loadStory } from './loadStory'

const MANIFEST = JSON.stringify({ name: '小故事', version: '1', engine: '0.1.0', entry: 'main.kin' })
const MAIN_KIN = '=== 开场 ===\n你站在门口。\n* [进去] -> END\n'

beforeEach(() => { readTextFile.mockReset(); readDir.mockReset() })

describe('loadStory', () => {
  it('旧 kiny.json 项目：列根定位 kiny.json 读 .kin 建出 Story + resolveAsset', async () => {
    readDir.mockImplementation(async (p: string) => {
      if (p.endsWith('/assets')) return []
      return [
        { name: 'kiny.json', isFile: true, isDirectory: false },
        { name: 'main.kin', isFile: true, isDirectory: false },
        { name: 'assets', isFile: false, isDirectory: true },
      ]
    })
    readTextFile.mockImplementation(async (p: string) => {
      if (p.endsWith('kiny.json')) return MANIFEST
      if (p.endsWith('main.kin')) return MAIN_KIN
      throw new Error('unexpected ' + p)
    })

    const out = await loadStory('/lib/a', 1)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.title).toBe('小故事')
    expect(out.resolveAsset('assets/x.jpg')).toBe('asset://localhost//lib/a/assets/x.jpg')
  })

  it('.kiw 项目：列根定位 <名>.kiw 作 manifest', async () => {
    readDir.mockImplementation(async (p: string) => {
      if (p.endsWith('/assets')) return []
      return [
        { name: '小故事.kiw', isFile: true, isDirectory: false },
        { name: 'main.kin', isFile: true, isDirectory: false },
      ]
    })
    readTextFile.mockImplementation(async (p: string) => {
      if (p.endsWith('.kiw')) return MANIFEST
      if (p.endsWith('main.kin')) return MAIN_KIN
      throw new Error('unexpected ' + p)
    })

    const out = await loadStory('/lib/b', 1)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.title).toBe('小故事')
  })

  it('根缺 manifest（无 .kiw 无 kiny.json）→ 报错', async () => {
    readDir.mockResolvedValue([{ name: 'main.kin', isFile: true, isDirectory: false }])
    const out = await loadStory('/lib/c')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('.kiw')
  })

  it('读盘失败 → 报错', async () => {
    readDir.mockResolvedValue([{ name: 'kiny.json', isFile: true, isDirectory: false }])
    readTextFile.mockRejectedValue(new Error('ENOENT'))
    const out = await loadStory('/lib/missing')
    expect(out.ok).toBe(false)
  })
})
