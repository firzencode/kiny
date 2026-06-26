/**
 * 节点跳转（goto-definition）与代码折叠（按节点头折叠节点体）。
 *
 * 路 A 无语法树，故折叠 / 跳转都基于文本行结构（复用 parseNodes 思路）：
 * - 跳转：光标落在 `-> 目标` 上时，从符号表解析目标节点（含 `节点.子节点`）的文件 + 行，
 *   跨文件目标交回 React 开 tab（host 接线）。
 * - 折叠：节点头（`=== 名 ===` / 子节点 `= 名`）可折叠其节点体到下一个同级头或文件尾。
 */
import { foldService } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { ValidatedProgram } from '@kiny/engine'

const KNOT_HEAD = /^\s*===\s*.+?\s*===\s*$/
const STITCH_HEAD = /^\s*=\s+\S/

function isKnotHead(line: string): boolean {
  return KNOT_HEAD.test(line)
}
function isStitchHead(line: string): boolean {
  return !isKnotHead(line) && STITCH_HEAD.test(line)
}

/** 光标列 `col` 落在本行哪个 `-> 目标` 的目标名上（返回目标串，否则 null）。 */
export function divertTargetAt(lineText: string, col: number): string | null {
  const re = /->\s*([^\s[\](){}]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lineText))) {
    const start = m.index + m[0].length - m[1].length
    const end = start + m[1].length
    if (col >= start && col <= end) return m[1]
  }
  return null
}

/** 解析跳转目标 `节点` 或 `节点.子节点` → 定义所在文件 + 行（1 起）。 */
export function resolveTarget(target: string, program: ValidatedProgram): { file: string; line: number } | null {
  const dot = target.indexOf('.')
  const knotName = dot >= 0 ? target.slice(0, dot) : target
  const stitchName = dot >= 0 ? target.slice(dot + 1) : null
  for (const f of program.files) {
    const knot = f.knots.find((k) => k.name === knotName)
    if (!knot) continue
    if (stitchName) {
      const st = knot.stitches.find((s) => s.name === stitchName)
      return { file: f.path, line: st ? st.line : knot.line }
    }
    return { file: f.path, line: knot.line }
  }
  return null
}

/** CM 适配：光标位置 + 符号表 → 跳转目标定义（文件 + 行）。 */
export function gotoTargetAt(
  state: EditorState,
  pos: number,
  program: ValidatedProgram | null,
): { file: string; line: number } | null {
  if (!program) return null
  const line = state.doc.lineAt(pos)
  const target = divertTargetAt(line.text, pos - line.from)
  if (!target) return null
  return resolveTarget(target, program)
}

/** 节点头所在行 → 可折叠的节点体行范围（1 起，含头行 fromLine 与末体行 toLine）；不可折叠返 null。 */
export function computeFoldRange(docText: string, headLine: number): { fromLine: number; toLine: number } | null {
  const lines = docText.split('\n')
  const idx = headLine - 1
  if (idx < 0 || idx >= lines.length) return null
  const knot = isKnotHead(lines[idx])
  const stitch = !knot && isStitchHead(lines[idx])
  if (!knot && !stitch) return null
  let end = lines.length - 1
  for (let i = idx + 1; i < lines.length; i++) {
    // knot 体一直到下个 knot 头；stitch 体到下个 stitch 头或 knot 头。
    if (isKnotHead(lines[i]) || (stitch && isStitchHead(lines[i]))) {
      end = i - 1
      break
    }
  }
  // 去掉体尾的空行（不把节点间空隙卷进折叠）。
  while (end > idx && lines[end].trim() === '') end--
  if (end <= idx) return null // 空体不折
  return { fromLine: headLine, toLine: end + 1 }
}

/** 折叠服务：把节点头行折叠成「头行尾 → 末体行尾」。 */
export const kinFoldService = foldService.of((state, lineStart) => {
  const head = state.doc.lineAt(lineStart)
  const range = computeFoldRange(state.doc.toString(), head.number)
  if (!range) return null
  return { from: state.doc.line(range.fromLine).to, to: state.doc.line(range.toLine).to }
})
