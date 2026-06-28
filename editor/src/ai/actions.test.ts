import { describe, it, expect } from 'vitest'
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from '../state/editorReducer'
import { createMemoryGateway } from '../files/memoryGateway'
import { createIncrementalValidator } from '../validate/validate'
import { runCommand, type ActionContext, type PreviewPort, type PreviewSnapshot } from './actions'

const DIR = '/proj'
const MAIN = `=== 开场 ===
你好。
* [去 A] -> A
=== A ===
A 节点。
-> END`
const A_KIN = `=== 起 ===
章节内容。
-> END`

/** 搭一套真 reducer + memoryGateway + 真校验器 + 假预览端口的测试上下文。 */
function makeHarness(files: Record<string, string> = {}) {
  let state: EditorState = initialEditorState
  const dispatch = (a: EditorAction) => { state = editorReducer(state, a) }
  const gateway = createMemoryGateway({
    files: {
      [`${DIR}/kiny.json`]: JSON.stringify({ name: 'demo', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
      [`${DIR}/main.kin`]: MAIN,
      [`${DIR}/chapters/a.kin`]: A_KIN,
      ...files,
    },
  })
  const validator = createIncrementalValidator()
  const previewCalls: unknown[][] = []
  const snap: PreviewSnapshot = { play: null, stale: false, choiceSeq: [] }
  const preview: PreviewPort = {
    snapshot: () => { previewCalls.push(['snapshot']); return snap },
    choose: (pos) => { previewCalls.push(['choose', pos]); return { play: null, stale: false, choiceSeq: [pos] } },
    restart: () => { previewCalls.push(['restart']); return snap },
  }
  const ctx: ActionContext = { getState: () => state, dispatch, gateway, validator, preview }
  return { ctx, getState: () => state, gateway, previewCalls }
}

/** 把项目读盘并 project_loaded 进 state（多数命令的前置）。 */
async function loadProject(h: ReturnType<typeof makeHarness>) {
  const proj = await h.gateway.readProject(DIR)
  h.ctx.dispatch({ type: 'project_loaded', project: proj })
}

describe('动作层 · 项目 / 文件', () => {
  it('listProject 返回项目结构', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'listProject' })
    expect(r.projectDir).toBe(DIR)
    expect(r.manifest?.entry).toBe('main.kin')
    expect(r.entries.map((e) => e.path)).toEqual(['chapters/a.kin', 'main.kin'])
    expect(r.activeFile).toBe('main.kin')
  })

  it('readFile 返回缓冲源码，缺文件抛错', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'readFile', path: 'main.kin' })
    expect(r.source).toBe(MAIN)
    expect(r.dirty).toBe(false)
    await expect(runCommand(h.ctx, { name: 'readFile', path: '不存在.kin' })).rejects.toThrow(/不存在/)
  })

  it('createFile 新建文件并打开为活动 tab', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'createFile', path: 'chapters/b' })
    expect(r.path).toBe('chapters/b.kin')
    expect(h.getState().files['chapters/b.kin']).toBeDefined()
    expect(h.getState().activeFile).toBe('chapters/b.kin')
  })

  it('writeFile 整体替换缓冲、标脏，不写盘', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'writeFile', path: 'main.kin', source: '=== 新 ===\n变了。' })
    expect(r.dirty).toBe(true)
    expect(h.getState().files['main.kin'].source).toBe('=== 新 ===\n变了。')
    expect(h.getState().files['main.kin'].dirty).toBe(true)
    // 未写盘：readProject 仍读到旧内容
    const disk = await h.gateway.readProject(DIR)
    expect(disk.files.find((f) => f.path === 'main.kin')?.source).toBe(MAIN)
  })

  it('未打开项目时 createFile 抛错', async () => {
    const h = makeHarness()
    await expect(runCommand(h.ctx, { name: 'createFile', path: 'x' })).rejects.toThrow(/未打开项目/)
  })

  it('renamePath 改名缓冲与磁盘', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'renamePath', from: 'chapters/a.kin', to: 'chapters/c.kin' })
    expect(h.getState().files['chapters/a.kin']).toBeUndefined()
    expect(h.getState().files['chapters/c.kin']).toBeDefined()
    const disk = await h.gateway.readProject(DIR)
    expect(disk.files.map((f) => f.path)).toContain('chapters/c.kin')
  })

  it('renamePath 改入口文件时同步 manifest', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'renamePath', from: 'main.kin', to: 'start.kin' })
    const disk = await h.gateway.readProject(DIR)
    expect(disk.manifest.entry).toBe('start.kin')
    expect(h.getState().entry).toBe('start.kin')
  })

  it('deletePath 删除文件；入口文件不可删', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'deletePath', path: 'chapters/a.kin' })
    expect(h.getState().files['chapters/a.kin']).toBeUndefined()
    await expect(runCommand(h.ctx, { name: 'deletePath', path: 'main.kin' })).rejects.toThrow(/入口/)
  })

  it('createFolder 新增空目录', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'createFolder', relDir: 'extras' })
    expect(h.getState().emptyDirs).toContain('extras')
  })
})

describe('动作层 · 节点 / 文本', () => {
  it('listNodes 列出节点', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'listNodes', path: 'main.kin' })
    expect(r.nodes.map((n) => n.name)).toEqual(['开场', 'A'])
    expect(r.nodes[0].line).toBe(1)
    expect(r.nodes[1].line).toBe(4)
  })

  it('readNode 返回节点源码切片；缺节点抛错', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'readNode', path: 'main.kin', node: 'A' })
    expect(r.line).toBe(4)
    expect(r.source).toContain('=== A ===')
    expect(r.source).toContain('-> END')
    expect(r.source).not.toContain('开场')
    await expect(runCommand(h.ctx, { name: 'readNode', path: 'main.kin', node: '无' })).rejects.toThrow(/节点不存在/)
  })

  it('replaceRange 替换区间、标脏，不写盘；越界抛错', async () => {
    const h = makeHarness()
    await loadProject(h)
    // 把开头 '=== 开场 ===' 的「开场」换成「序章」：开场在偏移 4..6
    const r = await runCommand(h.ctx, { name: 'replaceRange', path: 'main.kin', start: 4, end: 6, text: '序章' })
    expect(r.source.startsWith('=== 序章 ===')).toBe(true)
    expect(h.getState().files['main.kin'].dirty).toBe(true)
    const disk = await h.gateway.readProject(DIR)
    expect(disk.files.find((f) => f.path === 'main.kin')?.source).toBe(MAIN)
    await expect(runCommand(h.ctx, { name: 'replaceRange', path: 'main.kin', start: 0, end: 9999, text: '' }))
      .rejects.toThrow(/越界/)
  })

  it('insertText 插入文本、标脏；越界抛错', async () => {
    const h = makeHarness()
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'insertText', path: 'main.kin', offset: 0, text: '// 头注\n' })
    expect(r.source.startsWith('// 头注\n')).toBe(true)
    expect(h.getState().files['main.kin'].dirty).toBe(true)
    await expect(runCommand(h.ctx, { name: 'insertText', path: 'main.kin', offset: 9999, text: 'x' }))
      .rejects.toThrow(/越界/)
  })
})

describe('动作层 · 校验 / 诊断', () => {
  it('validate 跑全部缓冲、回写诊断、ok 反映有无 error', async () => {
    const h = makeHarness()
    await loadProject(h)
    const ok = await runCommand(h.ctx, { name: 'validate' })
    expect(ok.ok).toBe(true)
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    // 引入坏跳转 → ok false
    await runCommand(h.ctx, { name: 'writeFile', path: 'main.kin', source: '=== 开场 ===\n-> 不存在节点' })
    const bad = await runCommand(h.ctx, { name: 'validate' })
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    // 诊断已回写进 state
    expect(h.getState().diagnostics).toBe(bad.diagnostics)
  })

  it('getDiagnostics 可按文件过滤', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'writeFile', path: 'main.kin', source: '=== 开场 ===\n-> 不存在' })
    await runCommand(h.ctx, { name: 'validate' })
    const all = await runCommand(h.ctx, { name: 'getDiagnostics' })
    expect(all.diagnostics.length).toBeGreaterThan(0)
    const other = await runCommand(h.ctx, { name: 'getDiagnostics', path: 'chapters/a.kin' })
    expect(other.diagnostics.every((d) => d.file === 'chapters/a.kin')).toBe(true)
  })
})

describe('动作层 · 预览 / 运行', () => {
  it('preview / choose / restart 委派给预览端口', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'preview' })
    const c = await runCommand(h.ctx, { name: 'choose', pos: 1 })
    await runCommand(h.ctx, { name: 'restart' })
    expect(c.choiceSeq).toEqual([1])
    expect(h.previewCalls).toEqual([['snapshot'], ['choose', 1], ['restart']])
  })
})

describe('动作层 · 保存', () => {
  it('saveFile 把缓冲落盘并清脏', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'writeFile', path: 'main.kin', source: '=== 改 ===\n落盘。' })
    await runCommand(h.ctx, { name: 'saveFile', path: 'main.kin' })
    expect(h.getState().files['main.kin'].dirty).toBe(false)
    const disk = await h.gateway.readProject(DIR)
    expect(disk.files.find((f) => f.path === 'main.kin')?.source).toBe('=== 改 ===\n落盘。')
  })

  it('saveAll 落盘全部脏文件并返回路径', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'writeFile', path: 'main.kin', source: 'A' })
    await runCommand(h.ctx, { name: 'writeFile', path: 'chapters/a.kin', source: 'B' })
    const r = await runCommand(h.ctx, { name: 'saveAll' })
    expect(r.saved.sort()).toEqual(['chapters/a.kin', 'main.kin'])
    expect(Object.values(h.getState().files).every((f) => !f.dirty)).toBe(true)
    const disk = await h.gateway.readProject(DIR)
    expect(disk.files.find((f) => f.path === 'main.kin')?.source).toBe('A')
  })
})

describe('动作层 · 语言规范查询', () => {
  it('listKinSpec 返回目录（仅 id/title/level，无正文）', async () => {
    const h = makeHarness()
    const r = await runCommand(h.ctx, { name: 'listKinSpec' })
    expect(r.sections.length).toBeGreaterThan(10)
    expect(r.sections.map((s) => s.id)).toContain('5.3')
    expect(r.sections[0]).not.toHaveProperty('content')
  })

  it('readKinSpec 取章只回章引言 + 子节清单', async () => {
    const h = makeHarness()
    const r = await runCommand(h.ctx, { name: 'readKinSpec', id: '5' })
    expect(r.title.length).toBeGreaterThan(0)
    expect(r.children.map((c) => c.id)).toContain('5.3')
    expect(r.content).not.toContain('### 5.3') // 章引言不含子节正文
  })

  it('readKinSpec 取叶子节返回正文且 children 空', async () => {
    const h = makeHarness()
    const r = await runCommand(h.ctx, { name: 'readKinSpec', id: '5.3' })
    expect(r.content).toContain('5.3')
    expect(r.children).toEqual([])
  })

  it('readKinSpec 未知 id 抛错', async () => {
    const h = makeHarness()
    await expect(runCommand(h.ctx, { name: 'readKinSpec', id: '999' })).rejects.toThrow(/未知章节/)
  })
})
