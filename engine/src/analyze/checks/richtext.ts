import type { ProjectFile } from '../../parser/ast'
import type { Diagnostic } from '../types'

/** 把 parse 期收集的内联富文本问题（未闭合 / 错配标签、非法颜色 / 字号）转成 error 级诊断。 */
export function checkRichText(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const f of files) {
    for (const iss of f.richTextIssues) {
      out.push({ severity: 'error', code: iss.code, message: iss.message, file: f.path, line: iss.line })
    }
  }
  return out
}
