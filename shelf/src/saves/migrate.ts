import { readSave, writeSave } from './store'
import type { SaveRecord } from './types'

/** localStorage 版存档的键前缀：`kiny-shelf-save:<storyId>:<saveId>`。 */
const PREFIX = 'kiny-shelf-save:'

/** 遍历 localStorage 所有键（拷成数组，避免遍历中删改扰动索引）。 */
function allKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k !== null) keys.push(k)
  }
  return keys
}

/** 形状校验（迁移侧自持一份：旧记录没有 storyId，用不了 store 那份）。 */
function looksLikeSave(v: unknown): v is Omit<SaveRecord, 'storyId'> {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && (o.kind === 'auto' || o.kind === 'manual')
    && !!o.snapshot && !!o.play && !!o.meta
}

export interface MigrateResult {
  /** 成功搬进 IndexedDB 并删掉源键的条数。 */
  moved: number
  /** 解析失败 / 形状非法、直接删掉不搬的条数。 */
  dropped: number
  /** 目标已存在（前次搬过、只是源键没删成）、跳过不覆盖并清掉源键的条数。 */
  skipped: number
  /** 写入失败、源键保留待下次续搬的条数。 */
  failed: number
}

/**
 * 把 localStorage 里的旧存档一次性搬进 IndexedDB。**幂等**：判据就是「localStorage 里还有没有
 * 该前缀的键」，不需要额外的迁移完成标记——搬完即无键，再跑就是空转。
 *
 * 逐条搬、**写成功后才删源键**：中途失败（配额、事务中止）时已搬的保留、未搬的下次启动续搬，
 * 任何时刻都不存在「源已删、目标没写进去」的窗口。反向的窗口（目标已写、源键没删成）则靠
 * **目标已存在即跳过、绝不覆盖**兜住——否则残留的旧档会在下次启动时盖掉已被推进的新进度。
 *
 * ⚠ 只允许在**探测到 IndexedDB 可用**之后调用。降级态下写不进新库，若照跑就会在读者最没有
 * 退路的时候把 localStorage 里仅存的档也删掉。
 */
export async function migrateLocalStorageSaves(): Promise<MigrateResult> {
  const out: MigrateResult = { moved: 0, dropped: 0, skipped: 0, failed: 0 }
  for (const key of allKeys()) {
    if (!key.startsWith(PREFIX)) continue
    // `<storyId>:<saveId>`——storyId 本身不含冒号（UUID），故第一个冒号即分界。
    const rest = key.slice(PREFIX.length)
    const sep = rest.indexOf(':')
    const storyId = sep === -1 ? '' : rest.slice(0, sep)
    const raw = localStorage.getItem(key)
    let parsed: unknown = null
    try {
      parsed = raw === null ? null : JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (storyId === '' || !looksLikeSave(parsed)) {
      // 坏数据不搬进新库（与 listSaves 一贯的「跳过损坏项」同策略），直接清掉。
      localStorage.removeItem(key)
      out.dropped += 1
      continue
    }
    try {
      // 目标已有该档 → 说明前次已搬成、只是源键没删掉（commit 与 removeItem 之间被中断，
      // 或 removeItem 本身失败）。此时**绝不覆盖**：库里那条可能已被后续阅读推进过，
      // 拿旧档盖上去就是读者进度静默回退——迁移要消灭的正是这件事。
      if (await readSave(storyId, parsed.id)) {
        localStorage.removeItem(key)
        out.skipped += 1
        continue
      }
      await writeSave(storyId, { ...parsed, storyId })
      localStorage.removeItem(key) // 写成功才删源
      out.moved += 1
    } catch {
      out.failed += 1 // 源键保留，下次启动续搬
    }
  }
  return out
}
