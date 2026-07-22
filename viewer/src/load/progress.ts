import type { InteractionStep } from '@kiny/player'

/**
 * 阅读进度持久化（reader-design X5）：在线 demo / 导出网页刷新不再从头再来。
 * 按「故事名 + 版本」分桶存 `{ seed, seq }` 到 localStorage——seq 是读者交互序列（choice | input），
 * 配合确定性 seed 由 player 的 replayToStory 恢复到上次暂停点。改版（version 变）即天然弃旧进度。
 * 存的是交互序列而非引擎快照：轻量、且对选项文案改动免疫（choice 记位置）。
 */
export interface SavedProgress {
  seed: number
  seq: InteractionStep[]
}

const PREFIX = 'kiny-progress:'

/** localStorage 键：故事名 + 版本（改版弃旧进度）。 */
export function progressKey(title: string, version: string): string {
  return `${PREFIX}${title}@${version}`
}

function isStep(s: unknown): s is InteractionStep {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  return (o.kind === 'choice' && typeof o.pos === 'number') || (o.kind === 'input' && typeof o.text === 'string')
}

/** 读进度：无 / 解析失败 / 形状非法 → null（不抛，损坏视作无进度从头开始）。 */
export function loadProgress(key: string): SavedProgress | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null // localStorage 不可用（隐私模式 / 禁用）
  }
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    if (typeof o.seed !== 'number' || !Array.isArray(o.seq) || !o.seq.every(isStep)) return null
    return { seed: o.seed, seq: o.seq as InteractionStep[] }
  } catch {
    return null
  }
}

/** 写进度（localStorage 不可用时静默 no-op，不阻断播放）。 */
export function saveProgress(key: string, seed: number, seq: InteractionStep[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ seed, seq }))
  } catch {
    /* 配额满 / 不可用：进度存不了不影响当前阅读 */
  }
}

/** 清进度（「重新开始」用）。 */
export function clearProgress(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* no-op */
  }
}
