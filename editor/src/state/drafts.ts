// 自动保存恢复草稿：脏缓冲的后台快照，正交于显式保存（不碰真文件）。
// 纯逻辑 + 损坏降级 + LRU 上限，仿 session.ts。草稿落 Tauri app-data（经 FileGateway），
// 崩溃后重开检测「草稿内容 ≠ 磁盘文件」→ 弹恢复提示。

/** 一条缓冲草稿。base = 写草稿时对应「已保存版本」的标识（hashSource(savedSource)），
 *  用于判断草稿相对当前磁盘是否确为未保存更新、以及磁盘是否被外部改过。 */
export interface DraftRecord {
  source: string
  base: string
  ts: number // 最近写入时间戳（Date.now()），LRU 淘汰依据
}

/** 全部草稿：按项目目录 → 文件相对路径 → 草稿。 */
export interface DraftStore {
  version: 1
  projects: Record<string, Record<string, DraftRecord>>
}

/** 恢复时受影响的一项。 */
export interface RecoverableItem {
  path: string
  /** 草稿内容（恢复时载回缓冲）。 */
  source: string
  /** ok=正常未保存更新；diskChanged=磁盘自写草稿后被外部改过；missing=文件已删/改名。 */
  status: 'ok' | 'diskChanged' | 'missing'
}

/** 草稿写读的最小缓冲形状（避免依赖 editorReducer，防 gateway↔reducer 类型环）。 */
export interface DraftBuffer {
  path: string
  source: string
  savedSource: string
  dirty: boolean
}

export const DRAFT_VERSION = 1
/** 留存草稿的最多项目数（LRU 裁剪，防无限增长）。 */
export const MAX_DRAFT_PROJECTS = 20

export function emptyDraftStore(): DraftStore {
  return { version: DRAFT_VERSION, projects: {} }
}

/** 解析持久化文本；无 / 损坏 / 版本不符 → 空 store（降级，绝不抛）。 */
export function parseDraftStore(raw: string | null): DraftStore {
  if (!raw) return emptyDraftStore()
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== DRAFT_VERSION || typeof parsed.projects !== 'object' || parsed.projects === null) {
      return emptyDraftStore()
    }
    return parsed as DraftStore
  } catch {
    return emptyDraftStore()
  }
}

/** 内容标识：djb2 散列的十六进制串。同内容必同值，作 base 标识用。 */
export function hashSource(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/** 项目内最新草稿时间（LRU 排序键）；空项目记 0。 */
function projectTs(recs: Record<string, DraftRecord>): number {
  let max = 0
  for (const r of Object.values(recs)) if (r.ts > max) max = r.ts
  return max
}

/** LRU 裁剪：项目数超上限时淘汰最旧（按项目最新草稿时间）。返回新 store。 */
export function pruneProjects(store: DraftStore, max = MAX_DRAFT_PROJECTS): DraftStore {
  const dirs = Object.keys(store.projects)
  if (dirs.length <= max) return store
  const oldestFirst = dirs.sort((a, b) => projectTs(store.projects[a]) - projectTs(store.projects[b]))
  const projects = { ...store.projects }
  for (const d of oldestFirst.slice(0, dirs.length - max)) delete projects[d]
  return { ...store, projects }
}

/**
 * 把某项目当前缓冲对账进草稿：脏缓冲→写草稿（base=hash(savedSource)）、非脏→删草稿。
 * 项目草稿清空则删项目键；最后 LRU 裁剪。返回新 store（纯函数）。
 */
export function reconcileProjectDrafts(
  store: DraftStore,
  projectDir: string,
  buffers: DraftBuffer[],
  now: number,
): DraftStore {
  const prev = store.projects[projectDir] ?? {}
  const recs: Record<string, DraftRecord> = {}
  // 保留非本次缓冲集合里的既有草稿键？——缓冲集合即项目全部 .kin，故直接以缓冲为准重建。
  for (const b of buffers) {
    if (b.dirty) {
      const old = prev[b.path]
      // 内容未变则沿用旧时间戳（避免每次定时兜底都刷新 ts、扰乱 LRU）。
      const unchanged = old && old.source === b.source && old.base === hashSource(b.savedSource)
      recs[b.path] = unchanged ? old : { source: b.source, base: hashSource(b.savedSource), ts: now }
    }
    // 非脏：不写（= 删除其草稿）
  }
  const projects = { ...store.projects }
  if (Object.keys(recs).length === 0) delete projects[projectDir]
  else projects[projectDir] = recs
  return pruneProjects({ ...store, projects })
}

/** 清空某项目的全部草稿（干净退出 / 恢复对话框「丢弃」用）。返回新 store。 */
export function clearProjectDrafts(store: DraftStore, projectDir: string): DraftStore {
  if (!store.projects[projectDir]) return store
  const projects = { ...store.projects }
  delete projects[projectDir]
  return { ...store, projects }
}

/**
 * 检测某项目可恢复的草稿：草稿内容 ≠ 当前磁盘文件者。
 * - 草稿 source === 磁盘 source → 已保存，跳过。
 * - 磁盘无此文件（删/改名）→ missing。
 * - 磁盘有但 base ≠ hash(磁盘内容) → 磁盘自写草稿后被外部改过（diskChanged）。
 * - 否则 → ok（正常未保存更新）。
 * diskKinFiles：项目当前 .kin 文件 {path, source}（取自刚读盘的项目）。
 */
export function detectRecoverable(
  store: DraftStore,
  projectDir: string,
  diskKinFiles: { path: string; source: string }[],
): RecoverableItem[] {
  const recs = store.projects[projectDir]
  if (!recs) return []
  const disk = new Map(diskKinFiles.map((f) => [f.path, f.source]))
  const items: RecoverableItem[] = []
  for (const [path, rec] of Object.entries(recs)) {
    if (!disk.has(path)) {
      items.push({ path, source: rec.source, status: 'missing' })
      continue
    }
    const diskSource = disk.get(path)!
    if (rec.source === diskSource) continue // 已保存，无需恢复
    items.push({ path, source: rec.source, status: rec.base === hashSource(diskSource) ? 'ok' : 'diskChanged' })
  }
  return items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
