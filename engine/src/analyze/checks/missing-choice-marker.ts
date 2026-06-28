import type { ProjectFile, ContentBlock, ContentElement, TextLine } from '../../parser/ast'
import type { Diagnostic } from '../types'

/** 整行就是一个方括号片段，如「[向右走]」。 */
const BRACKET_LINE = /^\[[^\]]*\]$/

/** 拼接 TextLine 纯文本；含插值段（interp）则返回 null —— 必非纯方括号行。 */
function plainOf(line: TextLine): string | null {
  let s = ''
  for (const seg of line.segments) {
    if (seg.kind === 'literal') s += seg.value
    else if (seg.kind === 'break') continue
    else return null // interp
  }
  return s
}

/**
 * 漏写选项标记告警：某正文行整行是方括号片段、且紧跟一条无条件 divert，
 * 几乎必然是作者把 `* [..] -> ..` 漏写了 `*`/`+`，被解析成「正文 + 跳转」。
 */
export function checkMissingChoiceMarker(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []

  const scan = (block: ContentBlock, file: string): void => {
    for (let i = 0; i < block.length - 1; i++) {
      const el = block[i]!
      const next = block[i + 1]!
      if (el.kind === 'text' && next.kind === 'divert' &&
          next.target !== 'END' && next.target !== 'DONE') {
        const txt = plainOf(el)?.trim()
        if (txt && BRACKET_LINE.test(txt)) {
          out.push({
            severity: 'warning',
            code: 'missing-choice-marker',
            message: `这行像是漏写了选项标记 *（或 +）：「${txt}」被当作正文+跳转，而非一个选项。`,
            file,
            line: el.line,
          })
        }
      }
    }
    for (const el of block) recurse(el, file)
  }

  // 递归进嵌套正文（选项体 / @if 分支体），漏标记可能藏在任意层。
  const recurse = (el: ContentElement, file: string): void => {
    if (el.kind === 'choiceGroup') {
      for (const c of el.choices) scan(c.body, file)
    } else if (el.kind === 'conditional') {
      for (const b of el.branches) scan(b.body, file)
    }
  }

  for (const file of files) {
    scan(file.preamble, file.path)
    for (const knot of file.knots) {
      scan(knot.body, file.path)
      for (const st of knot.stitches) scan(st.body, file.path)
    }
  }
  return out
}
