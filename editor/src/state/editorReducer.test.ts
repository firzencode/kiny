import { describe, it, expect } from 'vitest'
import { editorReducer, initialEditorState, anyDirty, activeBuffer } from './editorReducer'
import type { LoadedProject } from '../files/gateway'

const project: LoadedProject = {
  dir: '/p',
  manifest: { name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' },
  manifestFile: 'kiny.json',
  files: [
    { path: 'main.kin', isKin: true, source: '-> 开场' },
    { path: '末.kin', isKin: true, source: '=== 末 ===' },
  ],
  emptyDirs: [],
}
const loaded = editorReducer(initialEditorState, { type: 'project_loaded', project })

describe('project_closed', () => {
  it('重置回初始态（projectDir=null），runId 单调自增', () => {
    const s = editorReducer(loaded, { type: 'project_closed' })
    expect(s.projectDir).toBeNull()
    expect(s.manifest).toBeNull()
    expect(s.entry).toBeNull()
    expect(s.files).toEqual({})
    expect(s.openTabs).toEqual([])
    expect(s.activeFile).toBeNull()
    // runId 不回退，避免上个项目的过期校验落到新态
    expect(s.runId).toBe(loaded.runId + 1)
  })
})

describe('editorReducer 多文件', () => {
  it('project_loaded：entries 含全部文件，files 仅 .kin，只开入口', () => {
    const proj: LoadedProject = {
      dir: '/p',
      manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' },
      manifestFile: 'kiny.json',
      files: [
        { path: 'main.kin', isKin: true, source: '=== a ===\n' },
        { path: 'assets/x.jpg', isKin: false },
      ],
      emptyDirs: ['art'],
    }
    const s = editorReducer(initialEditorState, { type: 'project_loaded', project: proj })
    expect(s.entries.map((e) => e.path)).toEqual(['assets/x.jpg', 'main.kin'])
    expect(Object.keys(s.files)).toEqual(['main.kin'])
    expect(s.emptyDirs).toEqual(['art'])
    expect(s.openTabs).toEqual(['main.kin'])
  })

  it('project_loaded：作品前端资源（css）进可编辑缓冲，但不进 fileOrder（非故事文件）', () => {
    const proj: LoadedProject = {
      dir: '/p',
      manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' },
      manifestFile: 'kiny.json',
      files: [
        { path: 'main.kin', isKin: true, source: '=== a ===\n' },
        { path: 'theme/skin.css', isKin: false, source: '.player{}' },
        { path: 'fonts/楷体.woff2', isKin: false },
      ],
      emptyDirs: [],
    }
    const s = editorReducer(initialEditorState, { type: 'project_loaded', project: proj })
    expect(Object.keys(s.files).sort()).toEqual(['main.kin', 'theme/skin.css'])
    expect(s.fileOrder).toEqual(['main.kin']) // 入口候选只列 .kin
    expect(s.openTabs).toEqual(['main.kin']) // 仍只开入口
  })

  it('file_created：新建 css 进缓冲并开 tab；二进制不进', () => {
    const withCss = editorReducer(loaded, { type: 'file_created', file: { path: 'a.css', isKin: false, source: '' } })
    expect(withCss.files['a.css']).toBeDefined()
    expect(withCss.openTabs).toContain('a.css')
    expect(withCss.activeFile).toBe('a.css')
    expect(withCss.fileOrder).not.toContain('a.css')
    const withPng = editorReducer(loaded, { type: 'file_created', file: { path: 'a.png', isKin: false } })
    expect(withPng.files['a.png']).toBeUndefined()
    expect(withPng.openTabs).not.toContain('a.png')
  })

  it('buffer_reloaded：覆盖式导入后缓冲与基线一起对齐新文本，不留脏', () => {
    const dirty = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: '旧改动' })
    expect(dirty.files['main.kin']!.dirty).toBe(true)
    const reloaded = editorReducer(dirty, { type: 'buffer_reloaded', path: 'main.kin', source: '磁盘新内容' })
    expect(reloaded.files['main.kin']).toMatchObject({ source: '磁盘新内容', savedSource: '磁盘新内容', dirty: false })
    expect(reloaded.runId).toBe(dirty.runId + 1)
  })

  it('buffer_reloaded：内容未变 / 无该缓冲 → 原样返回（不空转 runId）', () => {
    expect(editorReducer(loaded, { type: 'buffer_reloaded', path: 'main.kin', source: '-> 开场' })).toBe(loaded)
    expect(editorReducer(loaded, { type: 'buffer_reloaded', path: '不存在.css', source: 'x' })).toBe(loaded)
  })

  it('project_loaded：建全缓冲、entry 记录、只开入口 tab、runId++', () => {
    expect(Object.keys(loaded.files).sort()).toEqual(['main.kin', '末.kin'])
    expect(loaded.entry).toBe('main.kin')
    expect(loaded.openTabs).toEqual(['main.kin'])
    expect(loaded.activeFile).toBe('main.kin')
    expect(loaded.fileOrder).toEqual(['main.kin', '末.kin'])
    expect(loaded.runId).toBe(initialEditorState.runId + 1)
    expect(anyDirty(loaded)).toBe(false)
    expect(loaded.entries.map((e) => e.path)).toEqual(['main.kin', '末.kin'])
    expect(loaded.emptyDirs).toEqual([])
  })

  it('manifest_updated：整份替换 manifest + manifestFile，entry 同步顶层，不动文件缓冲', () => {
    const s = editorReducer(loaded, {
      type: 'manifest_updated',
      manifest: { name: '雾港改', version: '2.0.0', engine: '0.1.0', entry: '末.kin' },
      manifestFile: '雾港改.kiw',
    })
    expect(s.manifest).toEqual({ name: '雾港改', version: '2.0.0', engine: '0.1.0', entry: '末.kin' })
    expect(s.manifestFile).toBe('雾港改.kiw')
    expect(s.entry).toBe('末.kin')
    // 文件缓冲不受影响
    expect(Object.keys(s.files).sort()).toEqual(['main.kin', '末.kin'])
    expect(s.files).toBe(loaded.files)
    // entry 变更 → bump runId（触发预览重算）
    expect(s.runId).toBe(loaded.runId + 1)
  })

  it('manifest_updated：仅改 name/version（entry 不变）不 bump runId', () => {
    const s = editorReducer(loaded, {
      type: 'manifest_updated',
      manifest: { ...loaded.manifest!, name: '雾港改', version: '2.0.0' },
      manifestFile: '雾港改.kiw',
    })
    expect(s.entry).toBe('main.kin')
    expect(s.runId).toBe(loaded.runId) // entry 未变，不触发重算
  })

  it('source_changed：改对应缓冲 + dirty + runId++', () => {
    const s = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: 'X' })
    expect(s.files['main.kin'].source).toBe('X')
    expect(s.files['main.kin'].dirty).toBe(true)
    expect(s.runId).toBe(loaded.runId + 1)
    expect(anyDirty(s)).toBe(true)
    expect(activeBuffer(s)!.source).toBe('X')
  })

  it('open_tab / set_active 不改 runId', () => {
    const a = editorReducer(loaded, { type: 'open_tab', path: '末.kin' })
    expect(a.openTabs).toEqual(['main.kin', '末.kin'])
    expect(a.activeFile).toBe('末.kin')
    expect(a.runId).toBe(loaded.runId)
  })

  it('close_tab：关活动 tab 选邻居', () => {
    const opened = editorReducer(loaded, { type: 'open_tab', path: '末.kin' })
    const closed = editorReducer(opened, { type: 'close_tab', path: '末.kin' })
    expect(closed.openTabs).toEqual(['main.kin'])
    expect(closed.activeFile).toBe('main.kin')
  })

  it('close 最后一个 tab → activeFile=null', () => {
    const closed = editorReducer(loaded, { type: 'close_tab', path: 'main.kin' })
    expect(closed.openTabs).toEqual([])
    expect(closed.activeFile).toBeNull()
  })

  it('close 非活动 tab → 不动 activeFile', () => {
    const opened = editorReducer(loaded, { type: 'open_tab', path: '末.kin' }) // active=末.kin
    const back = editorReducer(opened, { type: 'set_active', path: 'main.kin' }) // active=main.kin
    const closed = editorReducer(back, { type: 'close_tab', path: '末.kin' }) // 关非活动
    expect(closed.openTabs).toEqual(['main.kin'])
    expect(closed.activeFile).toBe('main.kin')
  })

  it('open_tab / set_active 对不存在的路径是 no-op（越界守卫）', () => {
    const a = editorReducer(loaded, { type: 'open_tab', path: '幽灵.kin' })
    expect(a).toBe(loaded)
    const b = editorReducer(loaded, { type: 'set_active', path: '幽灵.kin' })
    expect(b).toBe(loaded)
  })

  it('file_created（.kin）：入列 + 开 tab + 设活动 + 加 entries + runId++', () => {
    const s = editorReducer(loaded, {
      type: 'file_created',
      file: { path: '盘问.kin', isKin: true, source: '=== 盘问 ===' },
    })
    expect(s.fileOrder).toEqual(['main.kin', '末.kin', '盘问.kin'])
    expect(s.openTabs).toContain('盘问.kin')
    expect(s.activeFile).toBe('盘问.kin')
    expect(s.runId).toBe(loaded.runId + 1)
    expect(s.entries.map((e) => e.path)).toContain('盘问.kin')
  })

  it('file_created（非 .kin）：只加 entries，不开 tab，不动 activeFile，不动 runId', () => {
    const before = loaded
    const after = editorReducer(before, {
      type: 'file_created',
      file: { path: 'assets/bg.png', isKin: false },
    })
    expect(after.entries.map((e) => e.path)).toContain('assets/bg.png')
    expect(after.openTabs).not.toContain('assets/bg.png')
    expect(after.activeFile).toBe(before.activeFile)
    expect(after.files['assets/bg.png']).toBeUndefined()
    expect(after.runId).toBe(before.runId)
  })

  it('saved / saved_all 清 dirty（written 与当前 source 一致的正常路径）', () => {
    const dirty = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: 'X' })
    expect(editorReducer(dirty, { type: 'saved', path: 'main.kin', written: 'X' }).files['main.kin'].dirty).toBe(false)
    const d2 = editorReducer(dirty, { type: 'source_changed', path: '末.kin', source: 'Y' })
    expect(anyDirty(editorReducer(d2, { type: 'saved_all', written: { 'main.kin': 'X', '末.kin': 'Y' } }))).toBe(false)
  })

  it('saved：写盘期间又输入（source 已超前于写盘内容）→ 保存后仍 dirty、基线为实际写盘文本', () => {
    // 场景：saveBuffer 捕获 source='V1' → await 写盘期间用户继续输入 'V2' → saved 到达。
    const v1 = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: 'V1' })
    const v2 = editorReducer(v1, { type: 'source_changed', path: 'main.kin', source: 'V2' })
    const s = editorReducer(v2, { type: 'saved', path: 'main.kin', written: 'V1' })
    expect(s.files['main.kin'].dirty).toBe(true) // V2 尚未落盘，不得清脏
    expect(s.files['main.kin'].savedSource).toBe('V1') // 基线 = 磁盘实际内容
    expect(s.files['main.kin'].source).toBe('V2') // 缓冲不动
  })

  it('saved_all：写盘期间某文件又输入 → 该文件仍 dirty，其余正常清脏', () => {
    const a = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: 'A1' })
    const b = editorReducer(a, { type: 'source_changed', path: '末.kin', source: 'B1' })
    const bLate = editorReducer(b, { type: 'source_changed', path: '末.kin', source: 'B2' }) // 写盘期间的追加输入
    const s = editorReducer(bLate, { type: 'saved_all', written: { 'main.kin': 'A1', '末.kin': 'B1' } })
    expect(s.files['main.kin'].dirty).toBe(false)
    expect(s.files['末.kin'].dirty).toBe(true)
    expect(s.files['末.kin'].savedSource).toBe('B1')
  })

  it('project_loaded：savedSource 记录磁盘内容（= source）', () => {
    expect(loaded.files['main.kin'].savedSource).toBe('-> 开场')
    expect(loaded.files['main.kin'].source).toBe('-> 开场')
  })

  it('discard_tab：脏 tab 回退到已保存内容 + 清 dirty + 关 tab + runId++', () => {
    const dirty = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: 'X' })
    const s = editorReducer(dirty, { type: 'discard_tab', path: 'main.kin' })
    expect(s.files['main.kin'].source).toBe('-> 开场') // 回退到加载时内容
    expect(s.files['main.kin'].dirty).toBe(false)
    expect(s.openTabs).not.toContain('main.kin')
    expect(s.runId).toBe(dirty.runId + 1)
  })

  it('discard_tab：saved 更新基线后，回退到该次保存的内容', () => {
    const v1 = editorReducer(loaded, { type: 'source_changed', path: 'main.kin', source: 'V1' })
    const saved = editorReducer(v1, { type: 'saved', path: 'main.kin', written: 'V1' })
    const v2 = editorReducer(saved, { type: 'source_changed', path: 'main.kin', source: 'V2' })
    const s = editorReducer(v2, { type: 'discard_tab', path: 'main.kin' })
    expect(s.files['main.kin'].source).toBe('V1')
    expect(s.files['main.kin'].dirty).toBe(false)
  })

  it('discard_tab：非脏 tab 等同关闭（不改 runId、不改 source）', () => {
    const opened = editorReducer(loaded, { type: 'open_tab', path: '末.kin' })
    const s = editorReducer(opened, { type: 'discard_tab', path: '末.kin' })
    expect(s.openTabs).toEqual(['main.kin'])
    expect(s.files['末.kin'].source).toBe('=== 末 ===')
    expect(s.runId).toBe(opened.runId)
  })

  it('validated：runId 守卫', () => {
    const stale = editorReducer(loaded, { type: 'validated', runId: 999, diagnostics: [{ severity: 'error', code: 'x', message: 'm', file: 'main.kin', line: 1 }] })
    expect(stale.diagnostics).toEqual([])
    const ok = editorReducer(loaded, { type: 'validated', runId: loaded.runId, diagnostics: [{ severity: 'warning', code: 'w', message: 'm', file: 'main.kin', line: 1 }] })
    expect(ok.diagnostics).toHaveLength(1)
  })
})

describe('path_renamed', () => {
  const loaded = () => editorReducer(initialEditorState, { type: 'project_loaded', project: {
    dir: '/p', manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }, manifestFile: 'kiny.json',
    files: [{ path: 'main.kin', isKin: true, source: 'M' }, { path: 'a.kin', isKin: true, source: 'A' }],
    emptyDirs: [],
  } })

  it('文件改名：迁缓冲 + tab + active', () => {
    let s = loaded()
    s = editorReducer(s, { type: 'open_tab', path: 'a.kin' })
    s = editorReducer(s, { type: 'path_renamed', from: 'a.kin', to: 'chapters/a.kin' })
    expect(s.files['chapters/a.kin']?.source).toBe('A')
    expect(s.files['a.kin']).toBeUndefined()
    expect(s.openTabs).toContain('chapters/a.kin')
    expect(s.activeFile).toBe('chapters/a.kin')
    expect(s.entries.some((e) => e.path === 'chapters/a.kin')).toBe(true)
  })

  it('入口改名：同步 manifest.entry', () => {
    let s = loaded()
    s = editorReducer(s, { type: 'path_renamed', from: 'main.kin', to: 'start.kin' })
    expect(s.entry).toBe('start.kin')
    expect(s.manifest?.entry).toBe('start.kin')
  })

  it('目录改名：前缀批量迁移', () => {
    let s = editorReducer(initialEditorState, { type: 'project_loaded', project: {
      dir: '/p', manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }, manifestFile: 'kiny.json',
      files: [{ path: 'main.kin', isKin: true, source: 'M' }, { path: 'ch/a.kin', isKin: true, source: 'A' }],
      emptyDirs: [],
    } })
    s = editorReducer(s, { type: 'path_renamed', from: 'ch', to: 'chapters' })
    expect(s.files['chapters/a.kin']).toBeDefined()
    expect(s.files['ch/a.kin']).toBeUndefined()
    expect(s.entries.some((e) => e.path === 'chapters/a.kin')).toBe(true)
    expect(s.entries.some((e) => e.path === 'ch/a.kin')).toBe(false)
  })

  it('from === to：原样返回，不动 runId', () => {
    const s = loaded()
    const after = editorReducer(s, { type: 'path_renamed', from: 'a.kin', to: 'a.kin' })
    expect(after).toBe(s)
  })

  it('目录改名：emptyDirs 同步', () => {
    let s = editorReducer(initialEditorState, { type: 'project_loaded', project: {
      dir: '/p', manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }, manifestFile: 'kiny.json',
      files: [{ path: 'main.kin', isKin: true, source: 'M' }],
      emptyDirs: ['art'],
    } })
    s = editorReducer(s, { type: 'path_renamed', from: 'art', to: 'pictures' })
    expect(s.emptyDirs).toEqual(['pictures'])
  })
})

describe('path_deleted / folder_created', () => {
  const loaded = () => editorReducer(initialEditorState, { type: 'project_loaded', project: {
    dir: '/p', manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }, manifestFile: 'kiny.json',
    files: [{ path: 'main.kin', isKin: true, source: 'M' }, { path: 'a.kin', isKin: true, source: 'A' }, { path: 'ch/b.kin', isKin: true, source: 'B' }],
    emptyDirs: [],
  } })

  it('删文件：丢缓冲 + 关 tab + 选邻居', () => {
    let s = loaded()
    s = editorReducer(s, { type: 'open_tab', path: 'a.kin' })
    s = editorReducer(s, { type: 'path_deleted', path: 'a.kin' })
    expect(s.files['a.kin']).toBeUndefined()
    expect(s.openTabs).not.toContain('a.kin')
    expect(s.activeFile).not.toBe('a.kin')
  })

  it('删目录：前缀批量丢', () => {
    let s = loaded()
    s = editorReducer(s, { type: 'open_tab', path: 'ch/b.kin' })
    s = editorReducer(s, { type: 'path_deleted', path: 'ch' })
    expect(s.files['ch/b.kin']).toBeUndefined()
    expect(s.entries.some((e) => e.path === 'ch/b.kin')).toBe(false)
    expect(s.openTabs).not.toContain('ch/b.kin')
  })

  it('folder_created：并入 emptyDirs', () => {
    const s = editorReducer(loaded(), { type: 'folder_created', relDir: 'art' })
    expect(s.emptyDirs).toContain('art')
  })

  it('删目录：活动 tab 在被删目录内 → 选左侧存活邻居', () => {
    let s = loaded()  // main.kin, a.kin, ch/b.kin
    s = editorReducer(s, { type: 'open_tab', path: 'a.kin' })
    s = editorReducer(s, { type: 'open_tab', path: 'ch/b.kin' }) // tabs: main.kin, a.kin, ch/b.kin; active ch/b.kin
    s = editorReducer(s, { type: 'path_deleted', path: 'ch' })
    expect(s.activeFile).toBe('a.kin') // 左邻居
  })

  it('删唯一打开的活动文件 → activeFile 变 null', () => {
    let s = loaded() // openTabs = ['main.kin'], active 'main.kin'
    s = editorReducer(s, { type: 'path_deleted', path: 'main.kin' })
    expect(s.activeFile).toBeNull()
  })

  it('删目录：活动 tab 左右都有存活 → 选左邻居（非旧索引）', () => {
    let s = editorReducer(initialEditorState, { type: 'project_loaded', project: {
      dir: '/p', manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' }, manifestFile: 'kiny.json',
      files: [{ path: 'main.kin', isKin: true, source: 'M' }, { path: 'ch/x.kin', isKin: true, source: 'X' }, { path: 'z.kin', isKin: true, source: 'Z' }],
      emptyDirs: [],
    } })
    s = editorReducer(s, { type: 'open_tab', path: 'ch/x.kin' })  // tabs: main.kin, ch/x.kin ; active ch/x.kin
    s = editorReducer(s, { type: 'open_tab', path: 'z.kin' })     // tabs: main.kin, ch/x.kin, z.kin ; active z.kin
    s = editorReducer(s, { type: 'set_active', path: 'ch/x.kin' })// active ch/x.kin (idx 1)
    s = editorReducer(s, { type: 'path_deleted', path: 'ch' })
    expect(s.activeFile).toBe('main.kin') // 左邻居（不是 z.kin）
  })
})

describe('project_loaded 会话恢复（restore）', () => {
  it('带 restore：用恢复的 openTabs / activeFile，不只开入口', () => {
    const s = editorReducer(initialEditorState, {
      type: 'project_loaded', project,
      restore: { openTabs: ['main.kin', '末.kin'], activeFile: '末.kin' },
    })
    expect(s.openTabs).toEqual(['main.kin', '末.kin'])
    expect(s.activeFile).toBe('末.kin')
  })

  it('restore 给空集合：openTabs 为空、无活动 tab', () => {
    const s = editorReducer(initialEditorState, {
      type: 'project_loaded', project,
      restore: { openTabs: [], activeFile: null },
    })
    expect(s.openTabs).toEqual([])
    expect(s.activeFile).toBeNull()
  })

  it('不带 restore：维持只开入口（回归）', () => {
    const s = editorReducer(initialEditorState, { type: 'project_loaded', project })
    expect(s.openTabs).toEqual(['main.kin'])
    expect(s.activeFile).toBe('main.kin')
  })

  it('restore 里的媒体 tab 保留，不可开的（字体）被剔除', () => {
    const s = editorReducer(initialEditorState, {
      type: 'project_loaded', project: mediaProject,
      restore: { openTabs: ['main.kin', '图/立绘.png', '字/楷体.woff2'], activeFile: '图/立绘.png' },
    })
    expect(s.openTabs).toEqual(['main.kin', '图/立绘.png'])
    expect(s.activeFile).toBe('图/立绘.png')
  })

  it('restore 的 activeFile 不可开时降级为首个可开 tab', () => {
    const s = editorReducer(initialEditorState, {
      type: 'project_loaded', project: mediaProject,
      restore: { openTabs: ['main.kin', '字/楷体.woff2'], activeFile: '字/楷体.woff2' },
    })
    expect(s.openTabs).toEqual(['main.kin'])
    expect(s.activeFile).toBe('main.kin')
  })
})

// 媒体 tab：图片 / 音频可开 tab 但**不进 files**（无文本缓冲）——
// 由此结构上永不脏、永不被保存、activeBuffer 返回 null。
const mediaProject: LoadedProject = {
  dir: '/p',
  manifest: { name: 'P', version: '1', engine: '0.1.0', entry: 'main.kin' },
  manifestFile: 'kiny.json',
  files: [
    { path: 'main.kin', isKin: true, source: '=== a ===' },
    { path: '图/立绘.png', isKin: false },
    { path: '音/雨.mp3', isKin: false },
    { path: '字/楷体.woff2', isKin: false },
  ],
  emptyDirs: [],
}
const withMedia = editorReducer(initialEditorState, { type: 'project_loaded', project: mediaProject })

describe('媒体 tab（图片 / 音频）', () => {
  it('open_tab 图片：进 openTabs 与 activeFile，但不进 files', () => {
    const s = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    expect(s.openTabs).toEqual(['main.kin', '图/立绘.png'])
    expect(s.activeFile).toBe('图/立绘.png')
    expect(s.files['图/立绘.png']).toBeUndefined()
    expect(activeBuffer(s)).toBeNull()
    expect(anyDirty(s)).toBe(false)
    expect(s.runId).toBe(withMedia.runId)
  })

  it('open_tab 音频同理；set_active 可切到已开的媒体 tab', () => {
    const s = editorReducer(withMedia, { type: 'open_tab', path: '音/雨.mp3' })
    expect(s.activeFile).toBe('音/雨.mp3')
    const back = editorReducer(s, { type: 'set_active', path: 'main.kin' })
    const again = editorReducer(back, { type: 'set_active', path: '音/雨.mp3' })
    expect(again.activeFile).toBe('音/雨.mp3')
  })

  it('字体 / 不存在的路径仍是 no-op（守卫只放开图片与音频）', () => {
    expect(editorReducer(withMedia, { type: 'open_tab', path: '字/楷体.woff2' })).toBe(withMedia)
    expect(editorReducer(withMedia, { type: 'set_active', path: '字/楷体.woff2' })).toBe(withMedia)
    expect(editorReducer(withMedia, { type: 'open_tab', path: '图/幽灵.png' })).toBe(withMedia)
  })

  it('重复 open_tab 不重复入列', () => {
    const once = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    const twice = editorReducer(once, { type: 'open_tab', path: '图/立绘.png' })
    expect(twice.openTabs).toEqual(['main.kin', '图/立绘.png'])
  })

  it('close_tab 媒体：摘除并选邻居', () => {
    const opened = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    const closed = editorReducer(opened, { type: 'close_tab', path: '图/立绘.png' })
    expect(closed.openTabs).toEqual(['main.kin'])
    expect(closed.activeFile).toBe('main.kin')
  })

  it('discard_tab 媒体：无缓冲可回退，只关 tab、不动 runId', () => {
    const opened = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    const s = editorReducer(opened, { type: 'discard_tab', path: '图/立绘.png' })
    expect(s.openTabs).toEqual(['main.kin'])
    expect(s.runId).toBe(opened.runId)
  })

  it('path_renamed：媒体 tab 与 activeFile 跟着改名', () => {
    const opened = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    const s = editorReducer(opened, { type: 'path_renamed', from: '图/立绘.png', to: '图/主角.png' })
    expect(s.openTabs).toEqual(['main.kin', '图/主角.png'])
    expect(s.activeFile).toBe('图/主角.png')
    expect(s.entries.map((e) => e.path)).toContain('图/主角.png')
  })

  it('path_renamed（父目录改名）：媒体 tab 路径前缀同步', () => {
    const opened = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    const s = editorReducer(opened, { type: 'path_renamed', from: '图', to: '插画' })
    expect(s.openTabs).toEqual(['main.kin', '插画/立绘.png'])
    expect(s.activeFile).toBe('插画/立绘.png')
  })

  it('path_deleted：媒体 tab 被摘除，活动落回邻居', () => {
    const opened = editorReducer(withMedia, { type: 'open_tab', path: '图/立绘.png' })
    const s = editorReducer(opened, { type: 'path_deleted', path: '图/立绘.png' })
    expect(s.openTabs).toEqual(['main.kin'])
    expect(s.activeFile).toBe('main.kin')
    expect(s.entries.map((e) => e.path)).not.toContain('图/立绘.png')
  })
})
