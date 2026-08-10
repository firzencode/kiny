import { describe, it, expect } from 'vitest'
import { createMemoryGateway } from './memoryGateway'
import { STARTER_THEME_CSS } from './gateway'


describe('memoryGateway readProject（路径模型）', () => {
  it('递归读全部文件（含子目录 + 非 .kin），按 path 升序，仅 .kin 带 source', async () => {
    const gw = createMemoryGateway({
      files: {
        '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/p/main.kin': '=== a ===\n',
        '/p/chapters/b.kin': '=== b ===\n',
        '/p/assets/x.jpg': 'BINARY',
      },
    })
    const proj = await gw.readProject('/p')
    expect(proj.files.map((f) => f.path)).toEqual(['assets/x.jpg', 'chapters/b.kin', 'main.kin'])
    const kin = proj.files.find((f) => f.path === 'chapters/b.kin')!
    expect(kin).toMatchObject({ isKin: true, source: '=== b ===\n' })
    expect(proj.files.find((f) => f.path === 'assets/x.jpg')).toMatchObject({ isKin: false, source: undefined })
  })

  it('列出空目录', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' },
      emptyDirs: { '/p': ['art'] },
    })
    expect((await gw.readProject('/p')).emptyDirs).toEqual(['art'])
  })

  it('缺入口文件 → 抛错', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/other.kin': '' },
    })
    await expect(gw.readProject('/p')).rejects.toThrow('main.kin')
  })

  it('createFile 支持子目录路径，重名抛错', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' },
    })
    const e = await gw.createFile('/p', 'chapters/new')
    expect(e).toMatchObject({ path: 'chapters/new.kin', isKin: true })
    await expect(gw.createFile('/p', 'chapters/new.kin')).rejects.toThrow('已存在')
  })

  it('createFile 建 .css：不被吞成 .kin，isKin false，落主题模板', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' },
    })
    const e = await gw.createFile('/p', 'theme.css')
    expect(e).toMatchObject({ path: 'theme.css', isKin: false, source: STARTER_THEME_CSS })
    expect(await gw.readTextFile('/p', 'theme.css')).toBe(STARTER_THEME_CSS)
  })

  it('createFile 建其它已知文本类型：留空内容、isKin false', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' },
    })
    const e = await gw.createFile('/p', 'notes.md')
    expect(e).toMatchObject({ path: 'notes.md', isKin: false, source: '' })
  })

  it('makeResolveAsset 用项目根相对路径', () => {
    const gw = createMemoryGateway({ files: {} })
    expect(gw.makeResolveAsset('/p')('assets/x.jpg')).toBe('mem://assets/x.jpg')
  })

  it('createFile 空名抛错', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }) },
    })
    await expect(gw.createFile('/p', '   ')).rejects.toThrow(/不能为空/)
  })
})

describe('memoryGateway 项目文件（.kiw）与打开', () => {
  it('readProject 定位 <名>.kiw 并回 manifestFile；.kiw 不进资源树', async () => {
    const gw = createMemoryGateway({
      files: {
        '/p/雾港之夜.kiw': JSON.stringify({ name: '雾港之夜', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/p/main.kin': '=== a ===\n',
      },
    })
    const proj = await gw.readProject('/p')
    expect(proj.manifestFile).toBe('雾港之夜.kiw')
    expect(proj.manifest.name).toBe('雾港之夜')
    expect(proj.files.map((f) => f.path)).toEqual(['main.kin']) // 无 .kiw
  })

  it('缺 manifest（无 .kiw 无 kiny.json）→ 抛错', async () => {
    const gw = createMemoryGateway({ files: { '/p/main.kin': '=== a ===\n' } })
    await expect(gw.readProject('/p')).rejects.toThrow('.kiw')
  })

  it('newProject 在 <parent>/<sanitize名> 铺 <名>.kiw（原名入 manifest）+ main.kin', async () => {
    const gw = createMemoryGateway({ files: {} })
    const dir = await gw.newProject('/loc', '雾港')
    expect(dir).toBe('/loc/雾港')
    const proj = await gw.readProject('/loc/雾港')
    expect(proj.manifestFile).toBe('雾港.kiw')
    expect(proj.manifest.name).toBe('雾港')
    expect(proj.manifest.entry).toBe('main.kin')
  })

  it('newProject 内置 theme.css（发现性：作者打开自己的项目就看见主题文件）', async () => {
    const gw = createMemoryGateway({ files: {} })
    const dir = await gw.newProject('/loc', '雾港')
    const proj = await gw.readProject(dir)
    expect(proj.files.map((f) => f.path)).toEqual(['main.kin', 'theme.css'])
    expect(await gw.readTextFile(dir, 'theme.css')).toBe(STARTER_THEME_CSS)
  })

  it('newProject 目标已存在 → 抛错、不覆盖', async () => {
    const gw = createMemoryGateway({ files: { '/loc/雾港/雾港.kiw': 'OLD' } })
    await expect(gw.newProject('/loc', '雾港')).rejects.toThrow('已存在')
  })

  it('pickDirectory 返回注入的 newParent', async () => {
    const gw = createMemoryGateway({ files: {}, newParent: '/loc' })
    expect(await gw.pickDirectory()).toBe('/loc')
  })

  it('自动迁移：打开旧 kiny.json 项目 → 重命名为 <项目名>.kiw', async () => {
    const gw = createMemoryGateway({
      files: {
        '/p/kiny.json': JSON.stringify({ name: '故事', version: '1', engine: '0.1.0', entry: 'main.kin' }),
        '/p/main.kin': '=== a ===\n',
      },
    })
    const proj = await gw.readProject('/p')
    expect(proj.manifestFile).toBe('故事.kiw') // 已迁移
    // 再次打开：磁盘上已是 .kiw，稳定定位同一文件、不再迁移。
    expect((await gw.readProject('/p')).manifestFile).toBe('故事.kiw')
  })

  it('pickProjectFile 返回注入的父目录', async () => {
    const gw = createMemoryGateway({ files: {}, projectFilePick: '/picked' })
    expect(await gw.pickProjectFile()).toBe('/picked')
    expect(await createMemoryGateway({ files: {} }).pickProjectFile()).toBeNull()
  })

  it('onOpenProjectFile 可注入触发；退订后不再回调', async () => {
    const hook: { fire?: (path: string) => void } = {}
    const gw = createMemoryGateway({ files: {}, openFileHook: hook })
    const got: string[] = []
    const un = await gw.onOpenProjectFile((path) => got.push(path))
    hook.fire!('/x/故事.kiw')
    expect(got).toEqual(['/x/故事.kiw'])
    un()
    expect(hook.fire).toBeUndefined()
  })

  it('takeLaunchProject 返回冷启动路径，单次消费（取走后为 null）', async () => {
    const gw = createMemoryGateway({ files: {}, launchProject: '/x/故事.kiw' })
    expect(await gw.takeLaunchProject()).toBe('/x/故事.kiw')
    expect(await gw.takeLaunchProject()).toBeNull() // 已消费
    expect(await createMemoryGateway({ files: {} }).takeLaunchProject()).toBeNull()
  })
})

describe('memoryGateway 文件管理原语', () => {
  const mk = (extra: Record<string, string> = {}, confirmResult = true) => createMemoryGateway({
    files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': 'X', ...extra },
    confirmResult,
  })

  it('createFolder → 出现在 emptyDirs', async () => {
    const gw = mk()
    await gw.createFolder('/p', 'art')
    expect((await gw.readProject('/p')).emptyDirs).toContain('art')
  })

  it('renamePath 文件：迁移内容', async () => {
    const gw = mk({ '/p/a.kin': 'AA' })
    await gw.renamePath('/p', 'a.kin', 'chapters/a.kin')
    const proj = await gw.readProject('/p')
    expect(proj.files.find((f) => f.path === 'chapters/a.kin')?.source).toBe('AA')
    expect(proj.files.some((f) => f.path === 'a.kin')).toBe(false)
  })

  it('renamePath 目录：批量前缀迁移', async () => {
    const gw = mk({ '/p/ch/a.kin': 'A', '/p/ch/b.kin': 'B' })
    await gw.renamePath('/p', 'ch', 'chapters')
    const paths = (await gw.readProject('/p')).files.map((f) => f.path)
    expect(paths).toContain('chapters/a.kin')
    expect(paths).toContain('chapters/b.kin')
  })

  it('renamePath 目标已存在 → 抛错', async () => {
    const gw = mk({ '/p/a.kin': 'A', '/p/b.kin': 'B' })
    await expect(gw.renamePath('/p', 'a.kin', 'b.kin')).rejects.toThrow('已存在')
  })

  it('deletePath 目录：递归删', async () => {
    const gw = mk({ '/p/ch/a.kin': 'A', '/p/ch/b.kin': 'B' })
    await gw.deletePath('/p', 'ch')
    expect((await gw.readProject('/p')).files.map((f) => f.path)).toEqual(['main.kin'])
  })

  it('writeManifest 改 entry（写回所定位的 manifest 文件）', async () => {
    const gw = mk({ '/p/start.kin': 'S' })
    await gw.writeManifest('/p', { name: 'P', version: '1', engine: '0.1.0', entry: 'start.kin' }, 'kiny.json')
    expect((await gw.readProject('/p')).manifest.entry).toBe('start.kin')
  })

  it('confirm 返回 init 配置值', async () => {
    expect(await mk({}, false).confirm('x')).toBe(false)
    expect(await mk({}, true).confirm('x')).toBe(true)
  })

  it('renamePath 拒绝把目录移入自身子树', async () => {
    const gw = mk({ '/p/ch/a.kin': 'A' })
    await expect(gw.renamePath('/p', 'ch', 'ch/sub')).rejects.toThrow('自身')
  })

  it('renamePath 目标是已存在目录 → 抛错', async () => {
    const gw = mk({ '/p/ch/a.kin': 'A', '/p/b.kin': 'B' })
    await expect(gw.renamePath('/p', 'b.kin', 'ch')).rejects.toThrow('已存在')
  })

  it('renamePath 拒绝 from 的 .. 穿越', async () => {
    const gw = mk({ '/p/a.kin': 'A' })
    await expect(gw.renamePath('/p', '../a.kin', 'b.kin')).rejects.toThrow('非法路径')
  })

  it('renamePath 空目录改名（仅 emptyDirs，无文件搬运）', async () => {
    const gw = createMemoryGateway({
      files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': 'X' },
      emptyDirs: { '/p': ['art'] },
    })
    await gw.renamePath('/p', 'art', 'pictures')
    expect((await gw.readProject('/p')).emptyDirs).toEqual(['pictures'])
  })
})

describe('closeWindow / onWindowCloseRequest', () => {
  it('closeWindow / onWindowCloseRequest：内存桩为安全 no-op', async () => {
    const gw = createMemoryGateway({ files: {} })
    await expect(gw.closeWindow()).resolves.toBeUndefined()
    const unlisten = await gw.onWindowCloseRequest(() => {
      throw new Error('内存桩不应回调关闭请求')
    })
    expect(typeof unlisten).toBe('function')
    expect(() => unlisten()).not.toThrow()
  })
})

describe('assertSafeRelPath 守卫', () => {
  it('createFile 拒绝 .. 穿越', async () => {
    const gw = createMemoryGateway({ files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' } })
    await expect(gw.createFile('/p', '../escape')).rejects.toThrow('非法路径')
  })
  it('renamePath 拒绝 .. 穿越', async () => {
    const gw = createMemoryGateway({ files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '', '/p/a.kin': 'A' } })
    await expect(gw.renamePath('/p', 'a.kin', '../a.kin')).rejects.toThrow('非法路径')
  })
  it('deletePath 拒绝 .. 穿越', async () => {
    const gw = createMemoryGateway({ files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '', '/danger/x.txt': 'X' } })
    await expect(gw.deletePath('/p', '../danger')).rejects.toThrow('非法路径')
  })
  it('writeFile 拒绝 .. 穿越（AI 驱动的写不得逃出项目根）', async () => {
    const gw = createMemoryGateway({ files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' } })
    await expect(gw.writeFile('/p', '../../evil.txt', 'pwned')).rejects.toThrow('非法路径')
  })
  it('writeManifest 拒绝 .. 穿越的 manifestFile', async () => {
    const gw = createMemoryGateway({ files: { '/p/kiny.json': JSON.stringify({ name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }), '/p/main.kin': '' } })
    await expect(gw.writeManifest('/p', { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }, '../evil.kiw')).rejects.toThrow('非法路径')
  })
})

describe('memoryGateway 导出相关', () => {
  it('pickSaveKipPath 返回 init.saveKipPath，缺省为 null', async () => {
    const base = {
      files: {
        '/proj/kiny.json': '{"name":"x","version":"1.0.0","engine":"0.1.0","entry":"main.kin"}',
        '/proj/main.kin': '=== 开场\n你好',
        '/proj/assets/c.bin': 'BYTES',
      },
    }
    expect(await createMemoryGateway({ ...base, saveKipPath: '/out/x.kip' }).pickSaveKipPath('x.kip')).toBe('/out/x.kip')
    expect(await createMemoryGateway({ ...base }).pickSaveKipPath('x.kip')).toBeNull()
  })

  it('exportKip 把 dir 下文件（除 kiny.json 外）记入 exportSink', async () => {
    const base = {
      files: {
        '/proj/kiny.json': '{"name":"x","version":"1.0.0","engine":"0.1.0","entry":"main.kin"}',
        '/proj/main.kin': '=== 开场\n你好',
        '/proj/assets/c.bin': 'BYTES',
      },
    }
    const sink: { dest: string; files: string[] }[] = []
    await createMemoryGateway({ ...base, exportSink: sink }).exportKip('/proj', '/out/x.kip')
    expect(sink).toEqual([{ dest: '/out/x.kip', files: ['assets/c.bin', 'main.kin'] }])
  })

  it('exportKip 在缺 manifest 时抛错', async () => {
    await expect(createMemoryGateway({ files: {} }).exportKip('/proj', '/out/x.kip')).rejects.toThrow('manifest')
  })
})

describe('memoryGateway AI 对话存储', () => {
  const store = { version: 1 as const, projectDir: '/p', conversations: [] }
  it('read/write/delete/list 往返', async () => {
    const gw = createMemoryGateway({ files: {} })
    expect(await gw.readChatStore('k1')).toBeNull()
    expect(await gw.listChatStoreKeys()).toEqual([])
    await gw.writeChatStore('k1', store)
    expect(await gw.readChatStore('k1')).toEqual(store)
    expect(await gw.listChatStoreKeys()).toEqual(['k1'])
    await gw.deleteChatStore('k1')
    expect(await gw.readChatStore('k1')).toBeNull()
    expect(await gw.listChatStoreKeys()).toEqual([])
  })
  it('read 返回深拷贝（外部改动不回写内部）', async () => {
    const gw = createMemoryGateway({ files: {}, chatStores: { k1: store } })
    const got = await gw.readChatStore('k1')
    got!.conversations.push({ id: 'x', title: 't', createdAt: 0, lastActivityAt: 0, turns: [], history: [] })
    expect((await gw.readChatStore('k1'))!.conversations).toHaveLength(0)
  })
  it('init.chatStores 预置可读', async () => {
    const gw = createMemoryGateway({ files: {}, chatStores: { a: store, b: { ...store, projectDir: '/q' } } })
    expect((await gw.listChatStoreKeys()).sort()).toEqual(['a', 'b'])
  })
})
