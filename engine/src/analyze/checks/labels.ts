import type { Diagnostic, SymbolTable } from '../types'

/** 标签全局唯一 + 标签不与变量重名。 */
export function checkLabels(table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []
  const varNames = new Set(table.declarations.map((d) => d.name))

  const seen = new Set<string>()
  for (const l of table.labels) {
    if (seen.has(l.name)) {
      out.push({ severity: 'error', code: 'duplicate-label', message: `选项标签重复：「${l.name}」`, file: l.file, line: l.line })
    } else {
      seen.add(l.name)
    }
    if (varNames.has(l.name)) {
      out.push({ severity: 'error', code: 'label-var-collision', message: `选项标签与变量同名：「${l.name}」`, file: l.file, line: l.line })
    }
  }
  return out
}
