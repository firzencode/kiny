import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import type { Story } from '@kiny/engine'

export interface LoadedStory {
  story: Story
  assetBase: string
  title: string
}
export type LoadOutcome = { ok: true; value: LoadedStory } | { ok: false; message: string }

/** 宿主注入的真随机种子（引擎 PRNG 默认种子固定，故由宿主提供熵源）。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000)
}

/**
 * 共享流水线（packaging-spec §3）：manifest 文本 + .kin 文本表 → engine 纯流水线 → Story。
 * 文本来源（fetch demo / 内联导出数据）由调用方决定；assetBase 决定资源 URL 前缀。
 */
export function buildStory(
  manifestText: string,
  files: Map<string, string>,
  assetBase: string,
  seed: number,
): LoadOutcome {
  const res = loadProjectFromFiles(manifestText, files)
  if (!res.ok) return { ok: false, message: res.errors.map((e) => e.message).join('; ') }

  const { program, diagnostics } = analyze(res.files)
  if (!program) {
    return { ok: false, message: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ') }
  }
  const start = resolveStart(program, res.entry)
  if (start === null) return { ok: false, message: '无可运行入口' }

  const story = createStory(program, { start, seed })
  return { ok: true, value: { story, assetBase, title: res.meta.name } }
}
