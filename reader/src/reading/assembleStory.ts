import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import type { Story, ValidatedProgram } from '@kiny/engine'

export type AssembleOutcome =
  // program 一并返回：读档时 restoreStory(program, snapshot) 需从同一份 .kin 重装的 program。
  | { ok: true; story: Story; title: string; program: ValidatedProgram }
  | { ok: false; message: string }

/**
 * 纯 engine 流水线（镜像 web-reader loadDemo 的内核，不含 IO）：
 * manifest 文本 + .kin 文件集 → 校验/合并/分析 → Story。
 * seed 默认随真随机，让 `.kin` 里 random(...) 每次游玩可能不同；测试传固定 seed 复现。
 */
export function assembleStory(
  manifestText: string,
  files: Map<string, string>,
  seed = Math.floor(Math.random() * 0x1_0000_0000),
): AssembleOutcome {
  const res = loadProjectFromFiles(manifestText, files)
  if (!res.ok) return { ok: false, message: res.errors.map((e) => e.message).join('; ') }

  const { program, diagnostics } = analyze(res.files)
  if (!program) {
    return { ok: false, message: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ') || '分析失败' }
  }
  const start = resolveStart(program, res.entry)
  if (start === null) return { ok: false, message: '无可运行入口' }

  const story = createStory(program, { start, seed })
  return { ok: true, story, title: res.meta.name, program }
}
