import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 全部 Tauri 运行时模块（tauriGateway 在 import 期即引用），newProject 只用到 open/writeTextFile/join。
const open = vi.fn()
const writeTextFile = vi.fn()
const mkdir = vi.fn()
const exists = vi.fn()
const readTextFile = vi.fn()
const readDir = vi.fn()
const remove = vi.fn()
const invoke = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => open(...a), ask: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (...a: unknown[]) => readTextFile(...a), writeTextFile: (...a: unknown[]) => writeTextFile(...a),
  readDir: (...a: unknown[]) => readDir(...a),
  mkdir: (...a: unknown[]) => mkdir(...a), exists: (...a: unknown[]) => exists(...a),
  rename: vi.fn(), remove: (...a: unknown[]) => remove(...a), BaseDirectory: { AppData: 'AppData' },
}))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (s: string) => s, invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ join: (...parts: string[]) => parts.join('/') }))

import { tauriFileGateway } from './tauriGateway'

describe('tauriFileGateway.newProject', () => {
  beforeEach(() => {
    [open, writeTextFile, mkdir, exists, invoke].forEach((m) => m.mockReset())
    exists.mockResolvedValue(false)
    writeTextFile.mockResolvedValue(undefined)
    mkdir.mockResolvedValue(undefined)
    invoke.mockResolvedValue(undefined)
  })

  it('只写 <名>.kiw + main.kin 脚手架，不创建 assets 目录', async () => {
    open.mockResolvedValue('/proj')
    const dir = await tauriFileGateway.newProject()
    expect(dir).toBe('/proj')
    // 脚手架两文件都写了（项目文件用 <名>.kiw，不再是 kiny.json）。
    const written = writeTextFile.mock.calls.map((c) => c[0] as string)
    expect(written).toContain('/proj/未命名项目.kiw')
    expect(written).toContain('/proj/main.kin')
    // 不再默认建 assets 目录（首次导入资源时按需创建即可）。
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('新建项目前先动态放行该目录（写盘可落任意位置）', async () => {
    open.mockResolvedValue('D:/anywhere/新项目')
    await tauriFileGateway.newProject()
    expect(invoke).toHaveBeenCalledWith('allow_project_dir', { dir: 'D:/anywhere/新项目' })
    // 放行发生在写盘之前。
    const grantOrder = invoke.mock.invocationCallOrder[0]
    const writeOrder = writeTextFile.mock.invocationCallOrder[0]
    expect(grantOrder).toBeLessThan(writeOrder)
  })

  it('用户取消选目录 → 返回 null、不写任何文件', async () => {
    open.mockResolvedValue(null)
    const dir = await tauriFileGateway.newProject()
    expect(dir).toBeNull()
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
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
