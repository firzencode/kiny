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

  it('作品前端资源：递归扫到的 .css 取文本编译、字体走 asset 协议注册 @font-face', async () => {
    readDir.mockImplementation(async (p: string) => {
      if (p.endsWith('/theme')) return [{ name: 'skin.css', isFile: true, isDirectory: false }]
      if (p.endsWith('/fonts')) return [{ name: '楷体.woff2', isFile: true, isDirectory: false }]
      return [
        { name: 'kiny.json', isFile: true, isDirectory: false },
        { name: 'main.kin', isFile: true, isDirectory: false },
        { name: 'theme', isFile: false, isDirectory: true },
        { name: 'fonts', isFile: false, isDirectory: true },
      ]
    })
    readTextFile.mockImplementation(async (p: string) => {
      if (p.endsWith('kiny.json')) return MANIFEST
      if (p.endsWith('main.kin')) return MAIN_KIN
      if (p.endsWith('skin.css')) return '.player{--kiny-page-bg:#fff}'
      throw new Error('unexpected ' + p)
    })

    const out = await loadStory('/lib/d', 1)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.projectCss).toContain('--kiny-page-bg:#fff')
    expect(out.projectCss).toContain('font-family: "楷体"')
    expect(out.projectCss).toContain('asset://localhost//lib/d/fonts/楷体.woff2')
    // 字体是二进制，绝不作文本读。
    expect(readTextFile.mock.calls.every((c) => !String(c[0]).endsWith('.woff2'))).toBe(true)
  })

  it('css 读失败 → 故事照常加载（样式缺失不阻断阅读）', async () => {
    readDir.mockImplementation(async (p: string) => {
      if (p.endsWith('/theme')) return [{ name: 'bad.css', isFile: true, isDirectory: false }]
      return [
        { name: 'kiny.json', isFile: true, isDirectory: false },
        { name: 'main.kin', isFile: true, isDirectory: false },
        { name: 'theme', isFile: false, isDirectory: true },
      ]
    })
    readTextFile.mockImplementation(async (p: string) => {
      if (p.endsWith('kiny.json')) return MANIFEST
      if (p.endsWith('main.kin')) return MAIN_KIN
      throw new Error('EACCES')
    })

    const out = await loadStory('/lib/e', 1)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.projectCss).toBe('')
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
