import { assembleFromFiles } from '@kiny/engine'
import type { Story, ValidatedProgram } from '@kiny/engine'

export type AssembleOutcome =
  // program 一并返回：读档时 restoreStory(program, snapshot) 需从同一份 .kin 重装的 program。
  | { ok: true; story: Story; title: string; program: ValidatedProgram }
  | { ok: false; message: string }

/**
 * engine 公共装配流水线的薄封装（不含 IO）：manifest 文本 + .kin 文件集 → Story。
 * seed 默认随真随机，让 `.kin` 里 random(...) 每次游玩可能不同；测试传固定 seed 复现。
 */
export function assembleStory(
  manifestText: string,
  files: Map<string, string>,
  seed = Math.floor(Math.random() * 0x1_0000_0000),
  manifestName = 'kiny.json',
): AssembleOutcome {
  const res = assembleFromFiles(manifestText, files, { seed, manifestName })
  if (!res.ok) return res
  return { ok: true, story: res.story, title: res.meta.name, program: res.program }
}
