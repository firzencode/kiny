import { describe, it, expect } from 'vitest'
import { createMemoryGateway } from './memoryGateway'


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

  it('writeManifest 改 entry', async () => {
    const gw = mk({ '/p/start.kin': 'S' })
    await gw.writeManifest('/p', { name: 'P', version: '1', engine: '0.1.0', entry: 'start.kin' })
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

  it('exportKip 在缺 kiny.json 时抛错', async () => {
    await expect(createMemoryGateway({ files: {} }).exportKip('/proj', '/out/x.kip')).rejects.toThrow('kiny.json')
  })
})
