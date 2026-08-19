import type { Diagnostic } from '@kiny/engine'
import { isKinFile, type LoadedProject, type Manifest, type ProjectFileEntry } from '../files/gateway'
import { underPath, entryAfterRename } from '../util/paths'
import { mediaKind } from '../files/media'
import type { ExternalSyncPayload } from '../files/rescan'

export interface FileBuffer {
  path: string
  source: string
  savedSource: string
  dirty: boolean
  /** 磁盘版在本缓冲脏期间被外部改写（savedSource 已对齐磁盘最新版）；保存或作者选择后清除。 */
  conflict?: boolean
  /** 文件已被外部删除但缓冲有未保存内容；保存即在原路径重建，丢弃则整体移除。 */
  missing?: boolean
}

export interface EditorState {
  projectDir: string | null
  manifest: Manifest | null
  manifestFile: string | null
  entry: string | null
  files: Record<string, FileBuffer>
  fileOrder: string[]
  entries: ProjectFileEntry[]
  emptyDirs: string[]
  openTabs: string[]
  activeFile: string | null
  diagnostics: Diagnostic[]
  /** 单调计数：内容变更（加载/编辑/新建）自增，用于丢弃过期校验。 */
  runId: number
}

export const initialEditorState: EditorState = {
  projectDir: null, manifest: null, manifestFile: null, entry: null,
  files: {}, fileOrder: [], entries: [], emptyDirs: [],
  openTabs: [], activeFile: null, diagnostics: [], runId: 0,
}

export type EditorAction =
  | { type: 'project_loaded'; project: LoadedProject; restore?: { openTabs: string[]; activeFile: string | null } }
  | { type: 'source_changed'; path: string; source: string }
  | { type: 'file_created'; file: ProjectFileEntry }
  /** 磁盘内容被外部替换（覆盖式导入）→ 缓冲与基线一并对齐到新文本，不留脏。 */
  | { type: 'buffer_reloaded'; path: string; source: string }
  /** 外部变更同步：重扫 diff 一次性应用（快照为新真相 + 干净刷新 / 冲突 / 删除指令）。 */
  | { type: 'external_sync'; sync: ExternalSyncPayload }
  /** 冲突裁决：useDisk=true 载入磁盘版（丢内存改动），false 保留内存版（仅清标记）。 */
  | { type: 'conflict_resolved'; path: string; useDisk: boolean }
  | { type: 'open_tab'; path: string }
  | { type: 'set_active'; path: string }
  | { type: 'close_tab'; path: string }
  | { type: 'discard_tab'; path: string }
  | { type: 'validated'; runId: number; diagnostics: Diagnostic[] }
  | { type: 'saved'; path: string; written: string }
  | { type: 'saved_all'; written: Record<string, string> }
  | { type: 'path_renamed'; from: string; to: string }
  | { type: 'path_deleted'; path: string }
  | { type: 'folder_created'; relDir: string }
  /** projectDir 是这份 manifest 所属的项目目录；与当前项目不符则整条丢弃（见 reducer）。 */
  | { type: 'manifest_updated'; manifest: Manifest; manifestFile: string; projectDir: string }
  | { type: 'project_closed' }

const sortNames = (ns: string[]) => [...ns].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
/** 可编辑缓冲 = gateway 载入了文本的文件（.kin + 作品前端资源 css/js/json/txt/md/html）。 */
const hasText = (f: ProjectFileEntry) => f.source !== undefined
/** 故事文件顺序（入口候选）只含 `.kin`——css 等资源不是故事文件。 */
const kinOnly = (paths: string[]) => sortNames(paths.filter(isKinFile))
const byPath = (a: ProjectFileEntry, b: ProjectFileEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
// key 在 from 子树下则改名，否则原样返回（entryAfterRename 返回 null 即不在子树下）。
const renameKey = (key: string, from: string, to: string): string => entryAfterRename(key, from, to) ?? key
/**
 * 可开 tab 的路径 = 有文本缓冲的文件，**或** 项目里的媒体文件（图片 / 音频）。
 * 媒体不进 `files`（它没有文本），故这条判据不能只看 `files`——但它同样是 tab，
 * 只是内容由 MediaView 只读呈现：永不脏、永不被保存、`activeBuffer` 对它返回 null。
 */
const canOpenTab = (s: EditorState, path: string): boolean =>
  s.files[path] !== undefined || (mediaKind(path) !== null && s.entries.some((e) => e.path === path))

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'project_loaded': {
      const files: Record<string, FileBuffer> = {}
      for (const f of a.project.files) if (hasText(f)) { const src = f.source ?? ''; files[f.path] = { path: f.path, source: src, savedSource: src, dirty: false } }
      const entry = a.project.manifest.entry
      const hasEntry = files[entry] !== undefined
      // restore（会话恢复）优先；调用方已用 resolveSession 对「文件还在不在」校验降级过。
      // 这里再滤一道「开得出吗」：有文本缓冲的，或图片 / 音频（字体等二进制没有查看器，
      // 恢复成 tab 只会得到一个空壳）。activeFile 落在被滤掉的路径上时降级为首个存活 tab。
      const openable = (p: string) =>
        files[p] !== undefined || (mediaKind(p) !== null && a.project.files.some((f) => f.path === p))
      const restored = a.restore ? a.restore.openTabs.filter(openable) : null
      const restoredActive = a.restore?.activeFile ?? null
      const openTabs = restored ?? (hasEntry ? [entry] : [])
      const activeFile = restored
        ? restoredActive !== null && restored.includes(restoredActive) ? restoredActive : restored[0] ?? null
        : hasEntry ? entry : null
      return {
        projectDir: a.project.dir, manifest: a.project.manifest, manifestFile: a.project.manifestFile, entry,
        files, fileOrder: kinOnly(Object.keys(files)),
        entries: [...a.project.files].sort(byPath),
        emptyDirs: a.project.emptyDirs,
        openTabs, activeFile,
        diagnostics: [], runId: s.runId + 1,
      }
    }
    case 'source_changed': {
      const cur = s.files[a.path]
      if (!cur) return s
      return { ...s, files: { ...s.files, [a.path]: { ...cur, source: a.source, dirty: true } }, runId: s.runId + 1 }
    }
    case 'file_created': {
      const f = a.file
      const src = f.source ?? ''
      const text = hasText(f)
      const files = text ? { ...s.files, [f.path]: { path: f.path, source: src, savedSource: src, dirty: false } } : s.files
      return {
        ...s, files,
        fileOrder: f.isKin ? sortNames([...s.fileOrder, f.path]) : s.fileOrder,
        entries: [...s.entries, f].sort(byPath),
        openTabs: text && !s.openTabs.includes(f.path) ? [...s.openTabs, f.path] : s.openTabs,
        activeFile: text ? f.path : s.activeFile,
        runId: f.isKin ? s.runId + 1 : s.runId,
      }
    }
    case 'buffer_reloaded': {
      // 覆盖式导入把磁盘换成了新内容：缓冲若还留着旧文本，之后一次保存就会把导入的内容写没。
      // 故连同已保存基线一起对齐（dirty=false），并 bump runId 让预览 / 校验重算。
      const cur = s.files[a.path]
      if (!cur || cur.source === a.source) return s
      return {
        ...s,
        files: { ...s.files, [a.path]: { ...cur, source: a.source, savedSource: a.source, dirty: false } },
        runId: s.runId + 1,
      }
    }
    case 'external_sync': {
      const { snapshot, reloaded, conflicted, missingDirty } = a.sync
      const files: Record<string, FileBuffer> = {}
      for (const f of snapshot.files) {
        if (!hasText(f)) {
          // 磁盘上文件仍存在，只是本轮 readTextFile 失败（Windows 文件锁等瞬时状况）：
          // 脏缓冲（含未保存改动）原样保留，不因一次读盘失败被静默丢弃、tab 也不能被关掉；
          // 干净缓冲可安全丢弃——内容以下一轮重扫的读盘结果为准。
          const cur = s.files[f.path]
          if (cur && cur.dirty) files[f.path] = { ...cur, missing: undefined }
          continue
        }
        const src = f.source ?? ''
        const cur = s.files[f.path]
        if (cur === undefined) { files[f.path] = { path: f.path, source: src, savedSource: src, dirty: false }; continue }
        // payload 里的 reloaded/conflicted 分类是 computeExternalSync 算出来时的快照；从算出到
        // 这里真正 dispatch 落地之间，reducer 可能已经处理过别的 action（用户键入 / 手动保存），
        // 缓冲的脏净状态可能已经变了。裁决权归这一刻的 cur.dirty，payload 只是建议，避免
        // 「按旧判断无条件覆写 source」丢键入，或「已保存却还留着冲突标记」的暂态。
        if (conflicted[f.path] !== undefined) {
          if (cur.dirty) files[f.path] = { ...cur, savedSource: conflicted[f.path], conflict: true, missing: undefined }
          else files[f.path] = { ...cur, source: conflicted[f.path], savedSource: conflicted[f.path], dirty: false, conflict: undefined, missing: undefined }
        } else if (reloaded[f.path] !== undefined) {
          if (cur.dirty) files[f.path] = { ...cur, savedSource: reloaded[f.path], conflict: true, missing: undefined }
          else files[f.path] = { ...cur, source: reloaded[f.path], savedSource: reloaded[f.path], dirty: false, conflict: undefined, missing: undefined }
        } else {
          files[f.path] = { ...cur, missing: undefined }
        }
      }
      // missing 文件的 conflict 标记无意义（磁盘上已无此文件），missing 的 banner 语义接管。
      for (const p of missingDirty) { const cur = s.files[p]; if (cur) files[p] = { ...cur, missing: true, conflict: undefined } }
      const entries = [...snapshot.files].sort(byPath)
      // tab 存活判据与 canOpenTab 同构，但对「missing 缓冲」放行（文件没了、稿还在）。
      const validTab = (p: string) => files[p] !== undefined || (mediaKind(p) !== null && entries.some((e) => e.path === p))
      const openTabs = s.openTabs.filter(validTab)
      let activeFile = s.activeFile
      if (activeFile !== null && !validTab(activeFile)) {
        const idx = s.openTabs.indexOf(activeFile)
        const left = s.openTabs.slice(0, idx).filter(validTab)
        const right = s.openTabs.slice(idx + 1).filter(validTab)
        activeFile = left[left.length - 1] ?? right[0] ?? null
      }
      return {
        ...s,
        manifest: snapshot.manifest, manifestFile: snapshot.manifestFile, entry: snapshot.manifest.entry,
        files, fileOrder: kinOnly(Object.keys(files)),
        entries, emptyDirs: [...snapshot.emptyDirs].sort(),
        openTabs, activeFile,
        runId: s.runId + 1,
      }
    }
    case 'conflict_resolved': {
      const cur = s.files[a.path]
      if (!cur || cur.conflict !== true) return s
      if (!a.useDisk) return { ...s, files: { ...s.files, [a.path]: { ...cur, conflict: undefined } } }
      // savedSource 在冲突标记期间持续跟进磁盘最新版，载入它即载入磁盘版。
      return {
        ...s,
        files: { ...s.files, [a.path]: { ...cur, source: cur.savedSource, dirty: false, conflict: undefined } },
        runId: s.runId + 1,
      }
    }
    case 'open_tab':
      if (!canOpenTab(s, a.path)) return s
      return { ...s, openTabs: s.openTabs.includes(a.path) ? s.openTabs : [...s.openTabs, a.path], activeFile: a.path }
    case 'set_active':
      if (!canOpenTab(s, a.path)) return s
      return { ...s, activeFile: a.path }
    case 'close_tab': {
      const idx = s.openTabs.indexOf(a.path)
      if (idx < 0) return s
      const openTabs = s.openTabs.filter((n) => n !== a.path)
      let activeFile = s.activeFile
      if (s.activeFile === a.path) activeFile = openTabs[idx - 1] ?? openTabs[idx] ?? null
      return { ...s, openTabs, activeFile }
    }
    case 'discard_tab': {
      // 不保存关 tab：把缓冲回退到已保存基线（= 磁盘内容），再关 tab。
      const idx = s.openTabs.indexOf(a.path)
      if (idx < 0) return s
      const openTabs = s.openTabs.filter((n) => n !== a.path)
      let activeFile = s.activeFile
      if (s.activeFile === a.path) activeFile = openTabs[idx - 1] ?? openTabs[idx] ?? null
      const cur = s.files[a.path]
      // missing 文件的丢弃 = 放弃重建：整体移除缓冲（磁盘上已无此文件，回退基线只会留幽灵）。
      if (cur != null && cur.missing === true) {
        const files: Record<string, FileBuffer> = {}
        for (const [k, v] of Object.entries(s.files)) if (k !== a.path) files[k] = v
        return { ...s, files, fileOrder: kinOnly(Object.keys(files)), openTabs, activeFile, runId: s.runId + 1 }
      }
      const reverted = cur != null && cur.dirty
      const files = reverted ? { ...s.files, [a.path]: { ...cur, source: cur.savedSource, dirty: false } } : s.files
      return { ...s, files, openTabs, activeFile, runId: reverted ? s.runId + 1 : s.runId }
    }
    case 'validated':
      if (a.runId !== s.runId) return s
      return { ...s, diagnostics: a.diagnostics }
    case 'saved': {
      // 基线 = 实际写盘的文本（action 携带），dirty 按当前缓冲与之对账——
      // await 写盘期间用户继续输入时，缓冲已超前于磁盘，不得误清脏（否则退出时静默丢数据）。
      const cur = s.files[a.path]
      if (!cur) return s
      const next: FileBuffer = { ...cur, dirty: cur.source !== a.written, savedSource: a.written, conflict: undefined, missing: undefined }
      const files = { ...s.files, [a.path]: next }
      // missing 文件的保存 = 在原路径重建：entries 补回（fileOrder 键集未变，无需重算）。
      if (cur.missing === true && !s.entries.some((e) => e.path === a.path)) {
        const rebuilt: ProjectFileEntry = { path: a.path, isKin: isKinFile(a.path), source: a.written }
        return { ...s, files, entries: [...s.entries, rebuilt].sort(byPath) }
      }
      return { ...s, files }
    }
    case 'saved_all': {
      const files: Record<string, FileBuffer> = {}
      const rebuilt: ProjectFileEntry[] = []
      for (const [k, v] of Object.entries(s.files)) {
        const written = a.written[k]
        if (written === undefined) { files[k] = v; continue }
        files[k] = { ...v, dirty: v.source !== written, savedSource: written, conflict: undefined, missing: undefined }
        if (v.missing === true && !s.entries.some((e) => e.path === k)) rebuilt.push({ path: k, isKin: isKinFile(k), source: written })
      }
      return rebuilt.length ? { ...s, files, entries: [...s.entries, ...rebuilt].sort(byPath) } : { ...s, files }
    }
    case 'path_renamed': {
      const { from, to } = a
      if (from === to) return s
      const files: Record<string, FileBuffer> = {}
      for (const [k, v] of Object.entries(s.files)) {
        const nk = renameKey(k, from, to)
        files[nk] = nk === k ? v : { ...v, path: nk }
      }
      const entries = s.entries.map((e) => {
        const np = renameKey(e.path, from, to)
        return np === e.path ? e : { ...e, path: np }
      }).sort(byPath)
      const emptyDirs = s.emptyDirs.map((d) => renameKey(d, from, to))
      const openTabs = s.openTabs.map((t) => renameKey(t, from, to))
      const activeFile = s.activeFile ? renameKey(s.activeFile, from, to) : null
      const entry = s.entry && underPath(s.entry, from) ? renameKey(s.entry, from, to) : s.entry
      const manifest = s.manifest && entry !== s.entry ? { ...s.manifest, entry: entry! } : s.manifest
      return { ...s, files, entries, emptyDirs, fileOrder: kinOnly(Object.keys(files)), openTabs, activeFile, entry, manifest, runId: s.runId + 1 }
    }
    case 'path_deleted': {
      const p = a.path
      const files: Record<string, FileBuffer> = {}
      for (const [k, v] of Object.entries(s.files)) if (!underPath(k, p)) files[k] = v
      const entries = s.entries.filter((e) => !underPath(e.path, p))
      const emptyDirs = s.emptyDirs.filter((d) => !underPath(d, p))
      const openTabs = s.openTabs.filter((t) => !underPath(t, p))
      let activeFile = s.activeFile
      if (activeFile && underPath(activeFile, p)) {
        const idx = s.openTabs.indexOf(activeFile)
        const left = s.openTabs.slice(0, idx).filter((t) => !underPath(t, p))
        const right = s.openTabs.slice(idx + 1).filter((t) => !underPath(t, p))
        activeFile = left[left.length - 1] ?? right[0] ?? null
      }
      return { ...s, files, entries, emptyDirs, fileOrder: kinOnly(Object.keys(files)), openTabs, activeFile, runId: s.runId + 1 }
    }
    case 'folder_created':
      return s.emptyDirs.includes(a.relDir) ? s : { ...s, emptyDirs: sortNames([...s.emptyDirs, a.relDir]) }
    case 'manifest_updated':
      // 项目设置保存 / 导出补写作品 id：整份替换 manifest（name/entry/version/id）+ 定位文件名
      // （改名后为新 `.kiw`）；entry 同步到顶层 s.entry（预览/入口校验读它）。不动文件缓冲 / 树。
      // entry 变更须 bump runId：预览重算由 runId 驱动（同 path_renamed），否则改启动入口后预览不刷新。
      //
      // 派发方都在若干次 await 之后才拿到结果（写盘 / 重命名 / 导出前的资源读取），期间作者可能已
      // 切换或关闭项目——那些闭包里的 manifest 属于**上一个**项目，落进来会把新项目的 manifest /
      // manifestFile 换成旧项目的，之后一次「项目设置保存」就把旧内容按旧文件名写进新项目目录。
      // 故按项目目录对账，不符即整条丢弃（同 externalControl 的 withProjectGuard）。
      if (s.projectDir !== a.projectDir) return s
      return {
        ...s, manifest: a.manifest, manifestFile: a.manifestFile, entry: a.manifest.entry,
        runId: a.manifest.entry !== s.entry ? s.runId + 1 : s.runId,
      }
    case 'project_closed':
      // 关闭项目：整体重置回初始态（顶层据 projectDir=null 切回启动页）。
      // runId 沿用递增，避免上个项目在途的过期校验回调落到已重置的空态。
      return { ...initialEditorState, runId: s.runId + 1 }
    default:
      return s
  }
}

/** 任一文件有未保存改动。 */
export function anyDirty(s: EditorState): boolean {
  return Object.values(s.files).some((f) => f.dirty)
}

/** 当前活动文件缓冲（无活动 tab 时 null）。 */
export function activeBuffer(s: EditorState): FileBuffer | null {
  return s.activeFile ? s.files[s.activeFile] ?? null : null
}
