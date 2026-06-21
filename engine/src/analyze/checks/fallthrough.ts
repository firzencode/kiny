import type { ProjectFile, ContentBlock } from '../../parser/ast'
import type { Diagnostic } from '../types'

/** 合法终点：以这些元素收尾的正文不算触底。 */
const TERMINAL = new Set(['divert', 'choiceGroup', 'conditional'])

/**
 * 节点/子节点正文触底无显式出口 → warning。
 * 只看节点正文与子节点正文：正文为空、或最后一个元素是被动元素
 * （text/command/logicLine/logicBlock）时报；以 divert / 选项组 / @if 块收尾算合法终点。
 * 不检查选项体 / @if 分支体——它们靠自身跳转或 gather 汇合到外层，不是独立出口。
 */
export function checkFallthrough(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []

  const fallsThrough = (block: ContentBlock): boolean => {
    const last = block[block.length - 1]
    return last === undefined || !TERMINAL.has(last.kind)
  }

  const warn = (file: string, line: number, what: string) =>
    out.push({ severity: 'warning', code: 'fallthrough', message: `${what}触底无显式出口`, file, line })

  for (const file of files) {
    // 开场：preamble 非空、末元素非终止、且文件有显式 knot → 触底告警（纯文本零-knot 文件触底属正常，不告警）
    if (file.preamble.length > 0 && file.knots.length > 0 && fallsThrough(file.preamble)) {
      warn(file.path, file.preamble[0]!.line, '开场')
    }
    for (const knot of file.knots) {
      if (fallsThrough(knot.body)) warn(file.path, knot.line, `节点「${knot.name}」`)
      for (const st of knot.stitches) {
        if (fallsThrough(st.body)) warn(file.path, st.line, `子节点「${st.name}」`)
      }
    }
  }
  return out
}
