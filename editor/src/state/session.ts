// 每个项目的编辑器会话（打开的 tab 集合 + 活动 tab），按项目路径持久化到 localStorage。
// 仿 settings.ts：纯函数 + 损坏降级 + 单 key。LRU 上限防止无限增长。

export interface ProjectSession {
  openTabs: string[]
  activeFile: string | null
  ts: number // 最近写入时间戳（Date.now()），LRU 淘汰依据
}

interface SessionStore {
  version: 1
  projects: Record<string, ProjectSession>
}

export const SESSION_KEY = 'kiny-editor-session'
export const MAX_PROJECTS = 20
const VERSION = 1

function emptyStore(): SessionStore {
  return { version: VERSION, projects: {} }
}

function loadStore(): SessionStore {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== VERSION || typeof parsed.projects !== 'object') return emptyStore()
    return parsed as SessionStore
  } catch {
    return emptyStore()
  }
}

/** 读单个项目会话；无 / 损坏 / 版本不符 → null。 */
export function loadSession(projectDir: string): ProjectSession | null {
  return loadStore().projects[projectDir] ?? null
}

/** 写单个项目会话：更新 ts、LRU 裁剪后落盘。openTabs 为空也照写。存储不可用静默。 */
export function saveSession(projectDir: string, openTabs: string[], activeFile: string | null): void {
  try {
    const store = loadStore()
    store.projects[projectDir] = { openTabs, activeFile, ts: Date.now() }
    const dirs = Object.keys(store.projects)
    if (dirs.length > MAX_PROJECTS) {
      const oldestFirst = dirs.sort((a, b) => store.projects[a].ts - store.projects[b].ts)
      for (const d of oldestFirst.slice(0, dirs.length - MAX_PROJECTS)) delete store.projects[d]
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(store))
  } catch {
    /* 存储不可用时静默——与 settings / theme / view 持久化一致 */
  }
}

/**
 * 把保存的会话对当前项目的实际文件做校验降级，算出要恢复的 tab。
 * - 过滤掉已不存在的路径（文件被删 / 改名）。
 * - activeFile 失效 → 降级到过滤后首个 tab。
 * - 过滤后全空（或无保存）→ 回退「只开入口」；入口本身也失效则空。
 */
export function resolveSession(
  saved: ProjectSession | null,
  validPaths: Set<string>,
  entry: string | null,
): { openTabs: string[]; activeFile: string | null } {
  const fallback = () =>
    entry && validPaths.has(entry)
      ? { openTabs: [entry], activeFile: entry }
      : { openTabs: [], activeFile: null }
  if (!saved) return fallback()
  const openTabs = saved.openTabs.filter((p) => validPaths.has(p))
  if (openTabs.length === 0) return fallback()
  const activeFile = saved.activeFile && openTabs.includes(saved.activeFile) ? saved.activeFile : openTabs[0]
  return { openTabs, activeFile }
}
