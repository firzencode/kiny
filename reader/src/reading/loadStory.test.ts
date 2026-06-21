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
  it('扫库目录读 .kin 文本建出 Story + resolveAsset', async () => {
    readDir.mockResolvedValue([
      { name: 'main.kin', isFile: true, isDirectory: false },
      { name: 'assets', isFile: false, isDirectory: true },
    ])
    readTextFile.mockImplementation(async (p: string) => {
      if (p.endsWith('kiny.json')) return MANIFEST
      if (p.endsWith('main.kin')) return MAIN_KIN
      throw new Error('unexpected ' + p)
    })
    // assets 子目录递归：再返回空
    readDir.mockResolvedValueOnce([
      { name: 'main.kin', isFile: true, isDirectory: false },
      { name: 'assets', isFile: false, isDirectory: true },
    ]).mockResolvedValueOnce([])

    const out = await loadStory('/lib/a', 1)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.title).toBe('小故事')
    expect(out.resolveAsset('assets/x.jpg')).toBe('asset://localhost//lib/a/assets/x.jpg')
  })

  it('读盘失败 → 报错', async () => {
    readTextFile.mockRejectedValue(new Error('ENOENT'))
    const out = await loadStory('/lib/missing')
    expect(out.ok).toBe(false)
  })
})
