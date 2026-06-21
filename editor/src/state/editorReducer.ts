import type { Diagnostic } from '@kiny/engine'
import type { LoadedProject, Manifest, ProjectFileEntry } from '../files/gateway'

export interface FileBuffer { path: string; source: string; savedSource: string; dirty: boolean }

export interface EditorState {
  projectDir: string | null
  manifest: Manifest | null
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
  projectDir: null, manifest: null, entry: null,
  files: {}, fileOrder: [], entries: [], emptyDirs: [],
  openTabs: [], activeFile: null, diagnostics: [], runId: 0,
}

export type EditorAction =
  | { type: 'project_loaded'; project: LoadedProject; restore?: { openTabs: string[]; activeFile: string | null } }
  | { type: 'source_changed'; path: string; source: string }
  | { type: 'file_created'; file: ProjectFileEntry }
  | { type: 'open_tab'; path: string }
  | { type: 'set_active'; path: string }
  | { type: 'close_tab'; path: string }
  | { type: 'discard_tab'; path: string }
  | { type: 'validated'; runId: number; diagnostics: Diagnostic[] }
  | { type: 'saved'; path: string }
  | { type: 'saved_all' }
  | { type: 'path_renamed'; from: string; to: string }
  | { type: 'path_deleted'; path: string }
  | { type: 'folder_created'; relDir: string }

const sortNames = (ns: string[]) => [...ns].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const byPath = (a: ProjectFileEntry, b: ProjectFileEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
const renameKey = (key: string, from: string, to: string): string =>
  key === from ? to : key.startsWith(`${from}/`) ? to + key.slice(from.length) : key
const underPath = (key: string, p: string): boolean => key === p || key.startsWith(`${p}/`)

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'project_loaded': {
      const files: Record<string, FileBuffer> = {}
      for (const f of a.project.files) if (f.isKin) { const src = f.source ?? ''; files[f.path] = { path: f.path, source: src, savedSource: src, dirty: false } }
      const entry = a.project.manifest.entry
      const hasEntry = files[entry] !== undefined
      // restore（会话恢复）优先；调用方已用 resolveSession 对当前文件校验降级过，这里直接采用。
      const openTabs = a.restore ? a.restore.openTabs : hasEntry ? [entry] : []
      const activeFile = a.restore ? a.restore.activeFile : hasEntry ? entry : null
      return {
        projectDir: a.project.dir, manifest: a.project.manifest, entry,
        files, fileOrder: sortNames(Object.keys(files)),
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
      const files = f.isKin ? { ...s.files, [f.path]: { path: f.path, source: src, savedSource: src, dirty: false } } : s.files
      return {
        ...s, files,
        fileOrder: f.isKin ? sortNames([...s.fileOrder, f.path]) : s.fileOrder,
        entries: [...s.entries, f].sort(byPath),
        openTabs: f.isKin && !s.openTabs.includes(f.path) ? [...s.openTabs, f.path] : s.openTabs,
        activeFile: f.isKin ? f.path : s.activeFile,
        runId: f.isKin ? s.runId + 1 : s.runId,
      }
    }
    case 'open_tab':
      if (!s.files[a.path]) return s
      return { ...s, openTabs: s.openTabs.includes(a.path) ? s.openTabs : [...s.openTabs, a.path], activeFile: a.path }
    case 'set_active':
      if (!s.files[a.path]) return s
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
      const reverted = cur != null && cur.dirty
      const files = reverted ? { ...s.files, [a.path]: { ...cur, source: cur.savedSource, dirty: false } } : s.files
      return { ...s, files, openTabs, activeFile, runId: reverted ? s.runId + 1 : s.runId }
    }
    case 'validated':
      if (a.runId !== s.runId) return s
      return { ...s, diagnostics: a.diagnostics }
    case 'saved': {
      const cur = s.files[a.path]
      if (!cur) return s
      return { ...s, files: { ...s.files, [a.path]: { ...cur, dirty: false, savedSource: cur.source } } }
    }
    case 'saved_all': {
      const files: Record<string, FileBuffer> = {}
      for (const [k, v] of Object.entries(s.files)) files[k] = v.dirty ? { ...v, dirty: false, savedSource: v.source } : v
      return { ...s, files }
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
      return { ...s, files, entries, emptyDirs, fileOrder: sortNames(Object.keys(files)), openTabs, activeFile, entry, manifest, runId: s.runId + 1 }
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
      return { ...s, files, entries, emptyDirs, fileOrder: sortNames(Object.keys(files)), openTabs, activeFile, runId: s.runId + 1 }
    }
    case 'folder_created':
      return s.emptyDirs.includes(a.relDir) ? s : { ...s, emptyDirs: sortNames([...s.emptyDirs, a.relDir]) }
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
