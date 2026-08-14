import { assembleFromFiles } from '@kiny/engine'
import type { Story, ValidatedProgram } from '@kiny/engine'
import { parseCharacters, type CharacterTable } from '@kiny/player'

export interface LoadedStory {
  story: Story
  assetBase: string
  /** 作品前端资源编译成的一段 css（@font-face + 各 .css）；无资源为空串。 */
  projectCss: string
  /** 作品角色表（`characters.json`）；未带 / 坏文件 = 空表，不着色。 */
  characters: CharacterTable
  title: string
  /** 故事版本（manifest version）；与 title 一起作阅读进度持久化的 key（改版即弃旧进度）。 */
  version: string
  /** 供保位重放恢复阅读进度用：program + start + 当前 run 的 seed。 */
  program: ValidatedProgram
  start: string
  seed: number
}
export type LoadOutcome = { ok: true; value: LoadedStory } | { ok: false; message: string }

/** 宿主注入的真随机种子（引擎 PRNG 默认种子固定，故由宿主提供熵源）。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000)
}

/**
 * engine 公共装配流水线的薄封装（packaging-spec §3）：manifest 文本 + .kin 文本表 → Story。
 * 文本来源（fetch demo / 内联导出数据）由调用方决定；assetBase 决定资源 URL 前缀。
 * projectCss 为作品前端资源编译出的 css（调用方按各自的取文本方式产出）。
 * charactersText 为 `characters.json` 的原始文本（同样由调用方按各自方式取到）——解析统一在此
 * 发生，四端只负责把文本递过来。
 * 返回 program/start/seed 供保位重放恢复进度。
 */
export function buildStory(
  manifestText: string,
  files: Map<string, string>,
  assetBase: string,
  seed: number,
  manifestName = 'kiny.json',
  projectCss = '',
  charactersText: string | null = null,
): LoadOutcome {
  const res = assembleFromFiles(manifestText, files, { seed, manifestName })
  if (!res.ok) return res
  return {
    ok: true,
    value: {
      story: res.story,
      assetBase,
      projectCss,
      characters: parseCharacters(charactersText),
      title: res.meta.name,
      version: res.meta.version,
      program: res.program,
      start: res.start,
      seed: res.seed,
    },
  }
}
