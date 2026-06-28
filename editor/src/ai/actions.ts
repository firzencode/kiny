import type { Diagnostic } from '@kiny/engine'
import type { PlayState } from '@kiny/player'
import type { EditorState, EditorAction } from '../state/editorReducer'
import type { FileGateway, Manifest, ProjectFileEntry } from '../files/gateway'
import type { ValidateResult } from '../validate/validate'
import { parseNodes, type NodeInfo } from '../syntax/kin'
import { tableOfContents, getSection, type SpecSection } from './kinSpec'
import { SPEC_SECTIONS } from './kinSpecData'

/**
 * 动作层（action layer · substrate，spec 2026-06-24-editor-ai-integration §2）。
 *
 * 把 editor 的全部能力收成**一组带类型参数的命令**，单一 dispatch 入口 {@link runCommand}。
 * 复用既有 `editorReducer` / `FileGateway` / `validate` / `parseNodes`，不另造逻辑。
 * 命令纯数据进出，便于既映射成 LLM tool-definition（T011c），又（Phase 2）映射成 REST 端点。
 *
 * 注入依赖（{@link ActionContext}），React 之外可测：动作层是一组薄函数，
 * 不依赖渲染。写类命令的产物落进正常编辑缓冲（脏标记 + 可撤销），不静默写盘——
 * 仅 saveFile / saveAll 经 gateway 落盘（spec §4）。
 */

/** 预览快照（当前 PlayState + 生效 choiceSeq + 是否陈旧）。 */
export interface PreviewSnapshot {
  play: PlayState | null
  stale: boolean
  choiceSeq: number[]
}

/**
 * 预览/运行端口。preview/choose/restart 命令委派给它。
 * 真实运行态（program、choiceSeq、replay）耦合 App 的渲染 ref，由 App（T011d）实现并注入；
 * 单测注入假端口。
 */
export interface PreviewPort {
  snapshot(): PreviewSnapshot
  choose(pos: number): PreviewSnapshot
  restart(): PreviewSnapshot
}

/** 动作层注入的依赖集。 */
export interface ActionContext {
  /** 当前 editor 状态取值器。 */
  getState(): EditorState
  /** 派发状态变更（写类命令的缓冲改动经此落脏标记/可撤销）。 */
  dispatch(action: EditorAction): void
  /** 文件 IO 隔离层。 */
  gateway: FileGateway
  /** 跨文件校验器（复用增量校验器实例）。 */
  validator: { validate(files: { path: string; source: string }[]): ValidateResult }
  /** 预览/运行端口。 */
  preview: PreviewPort
}

/** 命令联合（带类型参数）。 */
export type ActionCommand =
  // 项目 / 文件
  | { name: 'listProject' }
  | { name: 'readFile'; path: string }
  | { name: 'createFile'; path: string }
  | { name: 'writeFile'; path: string; source: string }
  | { name: 'renamePath'; from: string; to: string }
  | { name: 'deletePath'; path: string }
  | { name: 'createFolder'; relDir: string }
  // 节点 / 文本
  | { name: 'listNodes'; path: string }
  | { name: 'readNode'; path: string; node: string }
  | { name: 'replaceRange'; path: string; start: number; end: number; text: string }
  | { name: 'insertText'; path: string; offset: number; text: string }
  // 校验 / 诊断
  | { name: 'validate' }
  | { name: 'getDiagnostics'; path?: string }
  // 预览 / 运行
  | { name: 'preview' }
  | { name: 'choose'; pos: number }
  | { name: 'restart' }
  // 保存
  | { name: 'saveFile'; path: string }
  | { name: 'saveAll' }
  // 语言规范查询
  | { name: 'listKinSpec' }
  | { name: 'readKinSpec'; id: string }

export type ActionName = ActionCommand['name']

/** 命令名 → 结果类型映射。 */
export interface ResultMap {
  listProject: {
    projectDir: string | null
    manifest: Manifest | null
    entries: ProjectFileEntry[]
    emptyDirs: string[]
    openTabs: string[]
    activeFile: string | null
  }
  readFile: { path: string; source: string; dirty: boolean }
  createFile: { path: string }
  writeFile: { path: string; dirty: boolean }
  renamePath: { from: string; to: string }
  deletePath: { path: string }
  createFolder: { relDir: string }
  listNodes: { path: string; nodes: NodeInfo[] }
  readNode: { path: string; node: string; line: number; source: string }
  replaceRange: { path: string; source: string }
  insertText: { path: string; source: string }
  validate: { ok: boolean; diagnostics: Diagnostic[] }
  getDiagnostics: { diagnostics: Diagnostic[] }
  preview: PreviewSnapshot
  choose: PreviewSnapshot
  restart: PreviewSnapshot
  saveFile: { path: string }
  saveAll: { saved: string[] }
  listKinSpec: { sections: SpecSection[] }
  readKinSpec: { id: string; title: string; content: string; children: { id: string; title: string }[] }
}

export type ResultFor<N extends ActionName> = ResultMap[N]

/** 取一个已载入的 .kin 文件缓冲，缺失即抛错。 */
function buffer(ctx: ActionContext, path: string) {
  const buf = ctx.getState().files[path]
  if (!buf) throw new Error(`文件不存在或非 .kin: ${path}`)
  return buf
}

/** 取已打开的项目根目录，未打开即抛错。 */
function projectDir(ctx: ActionContext): string {
  const dir = ctx.getState().projectDir
  if (dir === null) throw new Error('未打开项目')
  return dir
}

/** 某路径是否即入口文件或其下后代（删除/改名时同步 manifest 入口用）。 */
function underPath(p: string, base: string): boolean {
  return p === base || p.startsWith(`${base}/`)
}

/**
 * 单一 dispatch 入口：执行一个动作层命令，返回该命令的类型化结果。
 * 非法参数（缺文件 / 越界 / 未打开项目等）抛 Error；调用方（如 agent 循环）按需包成 tool-result。
 */
export async function runCommand<C extends ActionCommand>(
  ctx: ActionContext,
  cmd: C,
): Promise<ResultFor<C['name']>> {
  switch (cmd.name) {
    // ---- 项目 / 文件 ----
    case 'listProject': {
      const s = ctx.getState()
      return {
        projectDir: s.projectDir,
        manifest: s.manifest,
        entries: s.entries,
        emptyDirs: s.emptyDirs,
        openTabs: s.openTabs,
        activeFile: s.activeFile,
      } as ResultFor<C['name']>
    }
    case 'readFile': {
      const buf = buffer(ctx, cmd.path)
      return { path: buf.path, source: buf.source, dirty: buf.dirty } as ResultFor<C['name']>
    }
    case 'createFile': {
      const dir = projectDir(ctx)
      const entry = await ctx.gateway.createFile(dir, cmd.path)
      ctx.dispatch({ type: 'file_created', file: entry })
      return { path: entry.path } as ResultFor<C['name']>
    }
    case 'writeFile': {
      buffer(ctx, cmd.path) // 存在性校验
      ctx.dispatch({ type: 'source_changed', path: cmd.path, source: cmd.source })
      return { path: cmd.path, dirty: true } as ResultFor<C['name']>
    }
    case 'renamePath': {
      const dir = projectDir(ctx)
      if (cmd.from === cmd.to) return { from: cmd.from, to: cmd.to } as ResultFor<C['name']>
      // dispatch 前捕获原入口：reducer 的 path_renamed 会就地把 state.entry 也改名。
      const before = ctx.getState()
      await ctx.gateway.renamePath(dir, cmd.from, cmd.to)
      ctx.dispatch({ type: 'path_renamed', from: cmd.from, to: cmd.to })
      // 入口文件被改名/移动 → 同步 kiny.json 的 entry
      if (before.manifest && before.entry && underPath(before.entry, cmd.from)) {
        const newEntry = before.entry === cmd.from ? cmd.to : cmd.to + before.entry.slice(cmd.from.length)
        await ctx.gateway.writeManifest(dir, { ...before.manifest, entry: newEntry })
      }
      return { from: cmd.from, to: cmd.to } as ResultFor<C['name']>
    }
    case 'deletePath': {
      const dir = projectDir(ctx)
      const s = ctx.getState()
      if (s.entry && underPath(s.entry, cmd.path)) throw new Error('入口文件不可删除')
      await ctx.gateway.deletePath(dir, cmd.path)
      ctx.dispatch({ type: 'path_deleted', path: cmd.path })
      return { path: cmd.path } as ResultFor<C['name']>
    }
    case 'createFolder': {
      const dir = projectDir(ctx)
      await ctx.gateway.createFolder(dir, cmd.relDir)
      ctx.dispatch({ type: 'folder_created', relDir: cmd.relDir })
      return { relDir: cmd.relDir } as ResultFor<C['name']>
    }
    // ---- 节点 / 文本 ----
    case 'listNodes': {
      const buf = buffer(ctx, cmd.path)
      return { path: buf.path, nodes: parseNodes(buf.source) } as ResultFor<C['name']>
    }
    case 'readNode': {
      const buf = buffer(ctx, cmd.path)
      const nodes = parseNodes(buf.source)
      const idx = nodes.findIndex((n) => n.name === cmd.node)
      if (idx < 0) throw new Error(`节点不存在: ${cmd.node}`)
      const lines = buf.source.split('\n')
      const startLine = nodes[idx].line // 1-based，含 === 头
      const endLine = idx + 1 < nodes.length ? nodes[idx + 1].line : lines.length + 1
      const source = lines.slice(startLine - 1, endLine - 1).join('\n')
      return { path: buf.path, node: cmd.node, line: startLine, source } as ResultFor<C['name']>
    }
    case 'replaceRange': {
      const buf = buffer(ctx, cmd.path)
      const len = buf.source.length
      if (cmd.start < 0 || cmd.end > len || cmd.start > cmd.end) {
        throw new Error(`replaceRange 越界: [${cmd.start}, ${cmd.end}] 超出 [0, ${len}]`)
      }
      const source = buf.source.slice(0, cmd.start) + cmd.text + buf.source.slice(cmd.end)
      ctx.dispatch({ type: 'source_changed', path: cmd.path, source })
      return { path: cmd.path, source } as ResultFor<C['name']>
    }
    case 'insertText': {
      const buf = buffer(ctx, cmd.path)
      const len = buf.source.length
      if (cmd.offset < 0 || cmd.offset > len) {
        throw new Error(`insertText 越界: ${cmd.offset} 超出 [0, ${len}]`)
      }
      const source = buf.source.slice(0, cmd.offset) + cmd.text + buf.source.slice(cmd.offset)
      ctx.dispatch({ type: 'source_changed', path: cmd.path, source })
      return { path: cmd.path, source } as ResultFor<C['name']>
    }
    // ---- 校验 / 诊断 ----
    case 'validate': {
      const s = ctx.getState()
      const files = Object.values(s.files).map((f) => ({ path: f.path, source: f.source }))
      const { diagnostics, program } = ctx.validator.validate(files)
      ctx.dispatch({ type: 'validated', runId: s.runId, diagnostics })
      return { ok: program !== null, diagnostics } as ResultFor<C['name']>
    }
    case 'getDiagnostics': {
      const all = ctx.getState().diagnostics
      const diagnostics = cmd.path ? all.filter((d) => d.file === cmd.path) : all
      return { diagnostics } as ResultFor<C['name']>
    }
    // ---- 预览 / 运行 ----
    case 'preview':
      return ctx.preview.snapshot() as ResultFor<C['name']>
    case 'choose':
      return ctx.preview.choose(cmd.pos) as ResultFor<C['name']>
    case 'restart':
      return ctx.preview.restart() as ResultFor<C['name']>
    // ---- 保存 ----
    case 'saveFile': {
      const dir = projectDir(ctx)
      const buf = buffer(ctx, cmd.path)
      await ctx.gateway.writeFile(dir, cmd.path, buf.source)
      ctx.dispatch({ type: 'saved', path: cmd.path })
      return { path: cmd.path } as ResultFor<C['name']>
    }
    case 'saveAll': {
      const dir = projectDir(ctx)
      const saved: string[] = []
      for (const f of Object.values(ctx.getState().files)) {
        if (f.dirty) { await ctx.gateway.writeFile(dir, f.path, f.source); saved.push(f.path) }
      }
      ctx.dispatch({ type: 'saved_all' })
      return { saved } as ResultFor<C['name']>
    }
    // ---- 语言规范查询 ----
    case 'listKinSpec':
      return { sections: tableOfContents(SPEC_SECTIONS) } as ResultFor<C['name']>
    case 'readKinSpec': {
      const sec = getSection(SPEC_SECTIONS, cmd.id)
      if (!sec) throw new Error(`未知章节 id: ${cmd.id}（可用章节见 listKinSpec）`)
      return sec as ResultFor<C['name']>
    }
    default: {
      const _exhaustive: never = cmd
      throw new Error(`未知命令: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/** 全部命令名（tool-definition 枚举 / 文档用）。 */
export const ACTION_NAMES: readonly ActionName[] = [
  'listProject', 'readFile', 'createFile', 'writeFile', 'renamePath', 'deletePath', 'createFolder',
  'listNodes', 'readNode', 'replaceRange', 'insertText',
  'validate', 'getDiagnostics',
  'preview', 'choose', 'restart',
  'saveFile', 'saveAll',
  'listKinSpec', 'readKinSpec',
]
