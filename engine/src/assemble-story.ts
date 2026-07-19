import { loadProjectFromFiles } from './project/memory'
import type { KinyMeta } from './project/types'
import { analyze, resolveStart } from './analyze'
import type { ValidatedProgram } from './analyze'
import { createStory } from './runtime'
import type { Story } from './runtime'

export interface AssembleOptions {
  /** 引擎 PRNG 种子；缺省随宿主真随机（同一 program 每次游玩 `random(...)` 可不同）。测试传固定值复现。 */
  seed?: number
  /** 所定位的 manifest 文件名（`<项目名>.kiw` 或旧 `kiny.json`），供错误消息定位。缺省 `kiny.json`。 */
  manifestName?: string
}

/** 装配出的一处内容警告（analyze 的 warning 级诊断，如触底无出口）。 */
export interface AssembleWarning {
  code: string
  message: string
  line: number
}

export type AssembleResult =
  | {
      ok: true
      story: Story
      /** 读档 `restoreStory(program, snapshot)` / 保位重放需从同一份 `.kin` 重装的 program。 */
      program: ValidatedProgram
      start: string
      /** 本次实际使用的种子（调用方缺省时为随机值，回传供持久化 / 复现）。 */
      seed: number
      /** `title = meta.name`、`version = meta.version` 由调用方按需取。 */
      meta: KinyMeta
      warnings: AssembleWarning[]
    }
  | { ok: false; message: string }

/**
 * 公共装配流水线：manifest 文本 + `.kin` 文件集 → 校验 / 合并 / 分析 / 起点解析 → Story。
 * 收敛 reader / tutorial / web-reader 三端此前各自手写、外围漂移（错误文案兜底、警告收集、返回形状）的复制。
 * 纯内存、无 IO——文件定位（`findManifest`）、读盘 / fetch、资源前缀（assetBase）留调用方 IO 层。
 * 错误经判别式 union 表达、不抛。
 */
export function assembleFromFiles(
  manifestText: string,
  files: Map<string, string>,
  opts: AssembleOptions = {},
): AssembleResult {
  const seed = opts.seed ?? Math.floor(Math.random() * 0x1_0000_0000)
  const res = loadProjectFromFiles(manifestText, files, opts.manifestName)
  if (!res.ok) return { ok: false, message: res.errors.map((e) => e.message).join('; ') }

  const { program, diagnostics } = analyze(res.files)
  if (!program) {
    return {
      ok: false,
      message: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ') || '分析失败',
    }
  }
  const start = resolveStart(program, res.entry)
  if (start === null) return { ok: false, message: '无可运行入口' }

  const warnings = diagnostics
    .filter((d) => d.severity === 'warning')
    .map((d) => ({ code: d.code, message: d.message, line: d.line }))
  const story = createStory(program, { start, seed })
  return { ok: true, story, program, start, seed, meta: res.meta, warnings }
}
