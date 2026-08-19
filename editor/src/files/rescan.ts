import type { LoadedProject } from './gateway'
import type { EditorState } from '../state/editorReducer'

/**
 * external_sync 的 payload：新快照 + 按缓冲状态分类好的同步指令。
 * 分类在这里（纯函数、重测试），结构性应用在 reducer 的 external_sync case。
 */
export interface ExternalSyncPayload {
  /** 新磁盘快照（entries / emptyDirs / manifest / manifestFile 的新真相）。 */
  snapshot: LoadedProject
  /** 干净缓冲 → path → 磁盘新文本（source 与 savedSource 一并对齐，不留脏）。 */
  reloaded: Record<string, string>
  /** 脏缓冲冲突 → path → 磁盘新文本（内容不动，savedSource 对齐并标 conflict）。 */
  conflicted: Record<string, string>
  /** 脏缓冲的文件已不在磁盘上 → 标 missing、保留缓冲与 tab。 */
  missingDirty: string[]
}

const sameStrings = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * 重扫 diff：内存状态 vs 新磁盘快照。事件只是信号，这里才是真相对账——
 * editor 自己保存的回环（磁盘 == savedSource）在此天然消化为零 diff。
 * 返回 null 表示零变化，调用方不 dispatch。
 */
export function computeExternalSync(
  state: Pick<EditorState, 'files' | 'entries' | 'emptyDirs' | 'manifest' | 'manifestFile'>,
  snapshot: LoadedProject,
): ExternalSyncPayload | null {
  const reloaded: Record<string, string> = {}
  const conflicted: Record<string, string> = {}
  const snapPaths = new Set(snapshot.files.map((f) => f.path))

  for (const f of snapshot.files) {
    if (f.source === undefined) continue
    const cur = state.files[f.path]
    if (cur === undefined || f.source === cur.savedSource) continue
    if (cur.dirty) conflicted[f.path] = f.source
    else reloaded[f.path] = f.source
  }
  // 脏缓冲在磁盘上已无对应文件（含此前已标 missing 的——每轮重申，直到保存重建或关 tab）。
  const missingDirty = Object.values(state.files)
    .filter((b) => b.dirty && !snapPaths.has(b.path))
    .map((b) => b.path)
    .sort()

  const structural =
    !sameStrings([...state.entries.map((e) => e.path)].sort(), [...snapshot.files.map((f) => f.path)].sort()) ||
    !sameStrings([...state.emptyDirs].sort(), [...snapshot.emptyDirs].sort()) ||
    state.manifestFile !== snapshot.manifestFile ||
    JSON.stringify(state.manifest) !== JSON.stringify(snapshot.manifest)

  const changed =
    structural ||
    Object.keys(reloaded).length > 0 ||
    Object.keys(conflicted).length > 0 ||
    missingDirty.length > 0
  if (!changed) return null
  return { snapshot, reloaded, conflicted, missingDirty }
}
