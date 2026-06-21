import { loadProject } from './load'
import { analyze, resolveStart, createStory, RuntimeError } from '../index'
import type { ProjectError, Diagnostic } from '../index'
import { play } from './player'
import type { Term } from './term'

/** 解析 argv：跳过 --seed 及其值后，第一个非 -- 项为项目目录；--seed <n> 取整数种子。 */
function parseArgs(argv: string[]): { rootDir: string; seed: number | undefined } {
  let seed: number | undefined
  const consumed = new Set<number>()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') {
      const v = Number(argv[i + 1])
      if (Number.isInteger(v)) seed = v
      consumed.add(i)
      consumed.add(i + 1)
      i++
    }
  }
  const rootDir = argv.find((a, i) => !consumed.has(i) && !a.startsWith('--')) ?? '.'
  return { rootDir, seed }
}

const fmtError = (e: ProjectError): string => {
  const loc = e.file ? (e.line ? `${e.file}:${e.line} ` : `${e.file} `) : ''
  return `error ${loc}${e.message}`
}
const fmtDiag = (d: Diagnostic): string => `${d.severity} ${d.file}:${d.line} ${d.message}`

/** CLI 主编排：加载项目 → analyze → 解析入口 → 建 Story → 播放。返回进程退出码。 */
export async function run(argv: string[], term: Term): Promise<number> {
  const { rootDir, seed } = parseArgs(argv)

  const res = loadProject(rootDir)
  if (!res.ok) {
    for (const e of res.errors) term.write(fmtError(e))
    return 1
  }

  const { program, diagnostics } = analyze(res.files)
  if (!program) {
    for (const d of diagnostics) term.write(fmtDiag(d))
    return 1
  }

  term.write(res.meta.name) // 标题先行
  for (const d of diagnostics) term.write(fmtDiag(d)) // program 有效 → 仅 warning

  const start = resolveStart(program, res.entry)
  if (start === null) {
    term.write('无可运行入口')
    return 1
  }

  const story = createStory(program, { start, seed })
  try {
    await play(story, term)
  } catch (e) {
    if (e instanceof RuntimeError) {
      const loc = e.file ? (e.line != null ? `${e.file}:${e.line} ` : `${e.file} `) : ''
      term.write(`运行期错误 ${loc}${e.message}`)
      return 1
    }
    throw e
  }
  return 0
}
