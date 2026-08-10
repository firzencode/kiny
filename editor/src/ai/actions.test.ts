import { describe, it, expect } from 'vitest'
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from '../state/editorReducer'
import { createMemoryGateway } from '../files/memoryGateway'
import { createIncrementalValidator, kinSourcesOf } from '../validate/validate'
import { STARTER_THEME_CSS } from '../files/gateway'
import type { InteractionStep } from '@kiny/player'
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
  const snap: PreviewSnapshot = { play: null, stale: false, interactionSeq: [] }
  const preview: PreviewPort = {
    snapshot: () => { previewCalls.push(['snapshot']); return snap },
    choose: (pos) => { previewCalls.push(['choose', pos]); return { play: null, stale: false, interactionSeq: [{ kind: 'choice', pos }] } },
    submitInput: (text) => { previewCalls.push(['submitInput', text]); return { play: null, stale: false, interactionSeq: [{ kind: 'input', text }] } },
    restart: () => { previewCalls.push(['restart']); return snap },
    back: () => { previewCalls.push(['back']); return snap },
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

  it('listProject 的 entries 只给 path/isKin/editable，不夹带 source', async () => {
    const h = makeHarness({
      [`${DIR}/theme.css`]: STARTER_THEME_CSS,
      [`${DIR}/assets/cover.jpg`]: 'binary-ish',
    })
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'listProject' })
    // 陈旧源码是真陷阱：它是**载入时**的磁盘快照，改过之后不更新，信它就会基于旧内容工作。
    for (const e of r.entries) expect(Object.keys(e).sort()).toEqual(['editable', 'isKin', 'path'])
    const byPath = Object.fromEntries(r.entries.map((e) => [e.path, e]))
    expect(byPath['main.kin']).toEqual({ path: 'main.kin', isKin: true, editable: true })
    // 作品前端资源：不是 Kin，但可读写——agent 靠这个口径就知道自己能调外观
    expect(byPath['theme.css']).toEqual({ path: 'theme.css', isKin: false, editable: true })
    // 二进制：既非 Kin 也不可编辑
    expect(byPath['assets/cover.jpg']).toEqual({ path: 'assets/cover.jpg', isKin: false, editable: false })
  })

  it('readFile 对作品前端资源同样可用（口径不是只有 .kin）', async () => {
    const h = makeHarness({ [`${DIR}/theme.css`]: STARTER_THEME_CSS })
    await loadProject(h)
    const r = await runCommand(h.ctx, { name: 'readFile', path: 'theme.css' })
    expect(r.source).toBe(STARTER_THEME_CSS)
    // 报错文案须与实际判据（缓冲是否存在）一致，不能说「非 .kin」——那是事实错误，
    // 会让 agent 认定 .css 不可读而放弃。
    await expect(runCommand(h.ctx, { name: 'readFile', path: 'assets/cover.jpg' }))
      .rejects.toThrow(/不是可编辑的文本文件/)
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

  it('缓冲含作品前端资源（theme.css / json / md）时 validate 不产出它们的假诊断', async () => {
    const h = makeHarness({
      [`${DIR}/theme.css`]: STARTER_THEME_CSS,
      [`${DIR}/data.json`]: '{ "a": 1 }',
      [`${DIR}/README.md`]: '# 说明 { 这行有个孤立花括号',
    })
    await loadProject(h)
    // 前置断言：这些资源确实进了缓冲（否则本用例测的是空气）
    expect(Object.keys(h.getState().files).sort()).toEqual(
      ['README.md', 'chapters/a.kin', 'data.json', 'main.kin', 'theme.css'],
    )
    const r = await runCommand(h.ctx, { name: 'validate' })
    expect(r.ok).toBe(true)
    expect(r.diagnostics.filter((d) => d.file !== undefined && !d.file.endsWith('.kin'))).toEqual([])
    // 与 editor 自身防抖校验逐字段一致（同一 kinSourcesOf 口径 + 同一校验器）
    const own = createIncrementalValidator().validate(kinSourcesOf(Object.values(h.getState().files)))
    expect(r.diagnostics).toEqual(own.diagnostics)
    expect(r.ok).toBe(own.program !== null)
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
  it('preview / choose / submitInput / restart 委派给预览端口', async () => {
    const h = makeHarness()
    await loadProject(h)
    await runCommand(h.ctx, { name: 'preview' })
    const c = await runCommand(h.ctx, { name: 'choose', pos: 1 })
    const s = await runCommand(h.ctx, { name: 'submitInput', text: '旅人' })
    await runCommand(h.ctx, { name: 'restart' })
    expect(c.interactionSeq).toEqual([{ kind: 'choice', pos: 1 }])
    expect(s.interactionSeq).toEqual([{ kind: 'input', text: '旅人' }])
    expect(h.previewCalls).toEqual([['snapshot'], ['choose', 1], ['submitInput', '旅人'], ['restart']])
  })

  // 动作层这一层只做**原样转发**（`case 'back': return ctx.preview.back()`），故这里只钉转发
  // 与快照透传；真实现（含空序列不重算那条真风险）在 `preview/previewPort.test.ts` 直接单测。
  describe('back（撤销上一次选择 / 输入）', () => {
    /** 维护真交互序列的假端口——choose/submitInput 追加、restart 清空、back 弹出末项。 */
    function statefulHarness() {
      let seq: InteractionStep[] = []
      const snap = (): PreviewSnapshot => ({ play: null, stale: false, interactionSeq: seq })
      const preview: PreviewPort = {
        snapshot: snap,
        choose: (pos) => { seq = [...seq, { kind: 'choice', pos }]; return snap() },
        submitInput: (text) => { seq = [...seq, { kind: 'input', text }]; return snap() },
        restart: () => { seq = []; return snap() },
        back: () => { seq = seq.slice(0, -1); return snap() },
      }
      const h = makeHarness()
      return { ...h, ctx: { ...h.ctx, preview } }
    }

    it('撤销一步：序列少一项', async () => {
      const h = statefulHarness()
      await runCommand(h.ctx, { name: 'choose', pos: 0 })
      const two = await runCommand(h.ctx, { name: 'choose', pos: 1 })
      expect(two.interactionSeq).toHaveLength(2)
      const back = await runCommand(h.ctx, { name: 'back' })
      expect(back.interactionSeq).toEqual([{ kind: 'choice', pos: 0 }])
    })

    it('空序列时动作层不额外加 guard，原样转发端口的返回', async () => {
      const h = statefulHarness()
      const r = await runCommand(h.ctx, { name: 'back' })
      expect(r.interactionSeq).toEqual([])
      // 想知道还能不能退，看快照的 interactionSeq 长度即可，不必靠抛错告知
      const again = await runCommand(h.ctx, { name: 'preview' })
      expect(again.interactionSeq).toEqual([])
    })
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

  // T039 验证点：AI 编排 @input 靠 readKinSpec 查语义，§11 命令表须能读到 @input（T037 已补入正本）。
  it('readKinSpec §11.1 命令集含 @input 语义（AI 编排 @input 的语言规范来源）', async () => {
    const h = makeHarness()
    const r = await runCommand(h.ctx, { name: 'readKinSpec', id: '11.1' })
    expect(r.content).toContain('@input')
  })
})
