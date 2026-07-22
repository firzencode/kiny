import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 全部 Tauri 运行时模块（tauriGateway 在 import 期即引用），newProject 只用到 open/writeTextFile/join。
const open = vi.fn()
const save = vi.fn()
const writeTextFile = vi.fn()
const mkdir = vi.fn()
const exists = vi.fn()
const readTextFile = vi.fn()
const readDir = vi.fn()
const remove = vi.fn()
const invoke = vi.fn()
const dirname = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => open(...a), ask: vi.fn(), save: (...a: unknown[]) => save(...a) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (...a: unknown[]) => readTextFile(...a), writeTextFile: (...a: unknown[]) => writeTextFile(...a),
  readDir: (...a: unknown[]) => readDir(...a),
  mkdir: (...a: unknown[]) => mkdir(...a), exists: (...a: unknown[]) => exists(...a),
  rename: vi.fn(), remove: (...a: unknown[]) => remove(...a), BaseDirectory: { AppData: 'AppData' },
}))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (s: string) => s, invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ join: (...parts: string[]) => parts.join('/'), dirname: (...a: unknown[]) => dirname(...a) }))

import { tauriFileGateway } from './tauriGateway'

describe('tauriFileGateway.exportThemeFile', () => {
  beforeEach(() => {
    [save, writeTextFile, invoke, dirname].forEach((m) => m.mockReset())
    writeTextFile.mockResolvedValue(undefined)
    invoke.mockResolvedValue(undefined)
    dirname.mockImplementation((p: string) => p.slice(0, p.lastIndexOf('/')))
  })

  it('选好落点 → 放行目标目录后写盘，返回 true', async () => {
    save.mockResolvedValue('D:/out/林夜.kiny-theme.json')
    const ok = await tauriFileGateway.exportThemeFile('林夜.kiny-theme.json', '{"a":1}')
    expect(ok).toBe(true)
    expect(save).toHaveBeenCalledWith({ defaultPath: '林夜.kiny-theme.json', filters: [{ name: 'Kiny 主题', extensions: ['json'] }] })
    expect(invoke).toHaveBeenCalledWith('allow_project_dir', { dir: 'D:/out' }) // 任意盘符位置先放行
    expect(writeTextFile).toHaveBeenCalledWith('D:/out/林夜.kiny-theme.json', '{"a":1}')
  })

  it('用户取消 → 返回 false，不写盘', async () => {
    save.mockResolvedValue(null)
    const ok = await tauriFileGateway.exportThemeFile('林夜.kiny-theme.json', '{"a":1}')
    expect(ok).toBe(false)
    expect(writeTextFile).not.toHaveBeenCalled()
  })
})

describe('tauriFileGateway.newProject / pickDirectory', () => {
  beforeEach(() => {
    [open, writeTextFile, mkdir, exists, invoke].forEach((m) => m.mockReset())
    exists.mockResolvedValue(false)
    writeTextFile.mockResolvedValue(undefined)
    mkdir.mockResolvedValue(undefined)
    invoke.mockResolvedValue(undefined)
  })

  it('在 <parent>/<sanitize名> 建目录并铺 <名>.kiw + main.kin，不建 assets', async () => {
    const dir = await tauriFileGateway.newProject('D:/loc', '雾港')
    expect(dir).toBe('D:/loc/雾港')
    expect(mkdir).toHaveBeenCalledWith('D:/loc/雾港') // 非递归：无 options
    const written = writeTextFile.mock.calls.map((c) => c[0] as string)
    expect(written).toContain('D:/loc/雾港/雾港.kiw')
    expect(written).toContain('D:/loc/雾港/main.kin')
    expect(written).not.toContain('D:/loc/雾港/assets')
  })

  it('写盘前先放行父目录', async () => {
    await tauriFileGateway.newProject('D:/loc', '雾港')
    expect(invoke).toHaveBeenCalledWith('allow_project_dir', { dir: 'D:/loc' })
  })

  it('放行父目录须早于 exists 探测（任意盘符位置 exists 也需先放行才不越界被拒）', async () => {
    await tauriFileGateway.newProject('D:/loc', '雾港')
    expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(exists.mock.invocationCallOrder[0])
  })

  it('目标已存在 → 抛错、不 mkdir、不写盘', async () => {
    exists.mockResolvedValue(true)
    await expect(tauriFileGateway.newProject('D:/loc', '雾港')).rejects.toThrow('已存在')
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('exists 探测通过但 mkdir 竞态失败 → 转「已存在」友好文案', async () => {
    exists.mockResolvedValue(false)
    mkdir.mockRejectedValueOnce(new Error('EEXIST'))
    await expect(tauriFileGateway.newProject('D:/loc', '雾港')).rejects.toThrow('已存在')
  })

  it('pickDirectory 走 open({directory:true})', async () => {
    open.mockResolvedValue('D:/x')
    expect(await tauriFileGateway.pickDirectory()).toBe('D:/x')
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false })
    open.mockResolvedValue(null)
    expect(await tauriFileGateway.pickDirectory()).toBeNull()
  })
})

describe('tauriFileGateway AI 对话存储', () => {
  const store = { version: 1 as const, projectDir: '/p', conversations: [] }
  beforeEach(() => {
    [writeTextFile, mkdir, exists, readTextFile, readDir, remove].forEach((m) => m.mockReset())
    writeTextFile.mockResolvedValue(undefined)
    mkdir.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
  })

  it('writeChatStore：建 ai-chats 目录后写 <key>.json 到 AppData', async () => {
    await tauriFileGateway.writeChatStore('abc', store)
    expect(mkdir).toHaveBeenCalledWith('ai-chats', { baseDir: 'AppData', recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('ai-chats/abc.json', JSON.stringify(store), { baseDir: 'AppData' })
  })

  it('readChatStore：文件存在 → 解析；不存在 → null', async () => {
    exists.mockResolvedValue(true)
    readTextFile.mockResolvedValue(JSON.stringify(store))
    expect(await tauriFileGateway.readChatStore('abc')).toEqual(store)
    exists.mockResolvedValue(false)
    expect(await tauriFileGateway.readChatStore('abc')).toBeNull()
  })

  it('readChatStore：损坏内容 → null（不抛）', async () => {
    exists.mockResolvedValue(true)
    readTextFile.mockResolvedValue('{坏 json')
    expect(await tauriFileGateway.readChatStore('abc')).toBeNull()
  })

  it('deleteChatStore：删对应文件，报错静默', async () => {
    await tauriFileGateway.deleteChatStore('abc')
    expect(remove).toHaveBeenCalledWith('ai-chats/abc.json', { baseDir: 'AppData' })
    remove.mockRejectedValueOnce(new Error('gone'))
    await expect(tauriFileGateway.deleteChatStore('abc')).resolves.toBeUndefined()
  })

  it('listChatStoreKeys：列 .json 去后缀；无目录 → []', async () => {
    exists.mockResolvedValue(true)
    readDir.mockResolvedValue([
      { name: 'a.json', isFile: true, isDirectory: false },
      { name: 'b.json', isFile: true, isDirectory: false },
      { name: 'sub', isFile: false, isDirectory: true },
      { name: 'note.txt', isFile: true, isDirectory: false },
    ])
    expect(await tauriFileGateway.listChatStoreKeys()).toEqual(['a', 'b'])
    exists.mockResolvedValue(false)
    expect(await tauriFileGateway.listChatStoreKeys()).toEqual([])
  })
})
