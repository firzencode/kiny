import { AUTO_SAVE_ID, type SaveRecord } from './types'

/**
 * localStorage 版存档 CRUD。键 `kiny-shelf-save:<storyId>:<saveId>`，一档一键——
 * 列举靠前缀扫描（无独立索引、不漂移），删除干净。浏览器 JS 单线程，无并发写乱序，
 * 故不需 reader 的 writeSaveSerial 串行队列。
 */
const PREFIX = 'kiny-shelf-save:'
const keyOf = (storyId: string, saveId: string) => `${PREFIX}${storyId}:${saveId}`

function isSaveRecord(v: unknown): v is SaveRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && (o.kind === 'auto' || o.kind === 'manual')
    && !!o.snapshot && !!o.play && !!o.meta
}

/** 遍历 localStorage 所有键（拷成数组，避免遍历中删改扰动索引）。 */
function allKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k !== null) keys.push(k)
  }
  return keys
}

/** 列出某书全部存档（损坏 / 形状非法者跳过）。 */
export function listSaves(storyId: string): SaveRecord[] {
  const p = `${PREFIX}${storyId}:`
  const out: SaveRecord[] = []
  for (const k of allKeys()) {
    if (!k.startsWith(p)) continue
    const raw = localStorage.getItem(k)
    if (raw === null) continue
    try {
      const v: unknown = JSON.parse(raw)
      if (isSaveRecord(v)) out.push(v)
    } catch {
      /* 损坏项跳过 */
    }
  }
  return out
}

/** 写 / 覆盖一条存档。配额满 / 不可用 → 抛错（调用方据实反馈，不谎报成功）。 */
export function writeSave(storyId: string, save: SaveRecord): void {
  localStorage.setItem(keyOf(storyId, save.id), JSON.stringify(save))
}

/** 读一条存档；不存在 / 损坏 → null。 */
export function readSave(storyId: string, saveId: string): SaveRecord | null {
  const raw = localStorage.getItem(keyOf(storyId, saveId))
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    return isSaveRecord(v) ? v : null
  } catch {
    return null
  }
}

/** 删一条存档。 */
export function deleteSave(storyId: string, saveId: string): void {
  localStorage.removeItem(keyOf(storyId, saveId))
}

/** 有 auto 续读档的 storyId 列表（书架「继续」入口探测）。 */
export function storiesWithAutoSave(): string[] {
  const suffix = `:${AUTO_SAVE_ID}`
  const ids: string[] = []
  for (const k of allKeys()) {
    if (k.startsWith(PREFIX) && k.endsWith(suffix)) {
      ids.push(k.slice(PREFIX.length, k.length - suffix.length))
    }
  }
  return ids
}

/** 清一书全部存档（删书时调，防孤儿存档残留）。 */
export function clearStorySaves(storyId: string): void {
  const p = `${PREFIX}${storyId}:`
  for (const k of allKeys()) {
    if (k.startsWith(p)) localStorage.removeItem(k)
  }
}

/** 生成手动存档 id（32 位十六进制，无横杠）。 */
export function genSaveId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
