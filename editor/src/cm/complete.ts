/**
 * Kin 补全源（`@codemirror/autocomplete`）。三类触发：
 * - `@` 后 → 内置命令名（固定清单，engine §11.1）
 * - 跳转 `->` 后 → 全文件节点名 / `节点.子节点`（符号表 knots/stitches，跨文件）
 * - 插值 `{}` 内或逻辑行（`~`）→ 作用域内变量名（globals ∪ 当前节点 locals）
 *
 * 匹配逻辑抽成纯函数（matchCommand/matchDivert/matchVariable）单测；CM 适配器
 * `kinCompletionSource` 从 `kinContextField` 读符号表、从 doc 现算当前节点。
 */
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import type { ValidatedProgram } from '@kiny/engine'
import { parseNodes } from '../syntax/kin'
import { getKinContext } from './context'

/** §11.1 内置命令名（engine COMMAND_NAMES 的 UI 副本；校验仍以 engine 为准）。 */
export const COMMAND_NAMES = ['bg_show', 'bg_hide', 'bgm_play', 'bgm_pause', 'bgm_stop', 'sfx']

/** 一次匹配的结果：backup = 已输入前缀长度（from = pos - backup）；options = 候选名。 */
export interface Match {
  backup: number
  options: string[]
}

/** `@命令` 补全：光标前是 `@` + 可选已输入命令名。 */
export function matchCommand(before: string): Match | null {
  const m = /@([A-Za-z_]\w*)?$/.exec(before)
  if (!m) return null
  return { backup: (m[1] ?? '').length, options: COMMAND_NAMES }
}

/** 跳转目标补全：光标前是 `->` + 可选 `节点` 或 `节点.子节点` 前缀。 */
export function matchDivert(
  before: string,
  knots: string[],
  stitchesOf: (knot: string) => string[],
): Match | null {
  // 节点名可为中文，故用与 tokenizeLine 一致的宽松目标模式（非空白 / 非括号）。
  const m = /->\s*([^\s[\](){}]*)$/.exec(before)
  if (!m) return null
  const partial = m[1] ?? ''
  if (partial.includes('.')) {
    const dot = partial.indexOf('.')
    const knot = partial.slice(0, dot)
    const stitchPartial = partial.slice(dot + 1)
    return { backup: stitchPartial.length, options: stitchesOf(knot) }
  }
  return { backup: partial.length, options: knots }
}

/** 变量补全：本行是逻辑行（`~`）或光标处于未闭合插值 `{` 内。 */
export function matchVariable(before: string, vars: string[]): Match | null {
  const inLogic = /^\s*~/.test(before)
  const opens = (before.match(/\{/g) ?? []).length
  const closes = (before.match(/\}/g) ?? []).length
  const inInterp = opens > closes
  if (!inLogic && !inInterp) return null
  const wm = /([A-Za-z_]\w*)$/.exec(before)
  return { backup: wm ? wm[1].length : 0, options: vars }
}

/** 作用域内变量：全局 ∪ 指定节点的 locals。 */
export function variablesInScope(prog: ValidatedProgram, knot: string | null): string[] {
  const out = new Set(prog.globals)
  if (knot) for (const v of prog.locals.get(knot) ?? []) out.add(v)
  return [...out]
}

function stitchNames(prog: ValidatedProgram, knot: string): string[] {
  const m = prog.stitches.get(knot)
  return m ? [...m.keys()] : []
}

/** 光标所在行落在哪个节点体内（取 line ≤ 光标行 的最近 === 节点）。 */
export function currentKnotAt(docText: string, cursorLine: number): string | null {
  const nodes = parseNodes(docText)
  let knot: string | null = null
  for (const n of nodes) {
    if (n.line <= cursorLine) knot = n.name
    else break
  }
  return knot
}

function toResult(pos: number, match: Match, type: Completion['type']): CompletionResult | null {
  if (match.options.length === 0) return null
  return {
    from: pos - match.backup,
    options: match.options.map((label) => ({ label, type })),
    validFor: /^[\w.]*$/,
  }
}

export function kinCompletionSource(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const prog = getKinContext(state).program

  const cmd = matchCommand(before)
  if (cmd) return toResult(pos, cmd, 'keyword')

  if (prog) {
    const div = matchDivert(before, [...prog.knots.keys()], (k) => stitchNames(prog, k))
    if (div) return toResult(pos, div, 'function')

    const knot = currentKnotAt(state.doc.toString(), line.number)
    const v = matchVariable(before, variablesInScope(prog, knot))
    if (v) return toResult(pos, v, 'variable')
  }
  return null
}
