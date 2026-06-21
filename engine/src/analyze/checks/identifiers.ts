import type { Diagnostic, SymbolTable } from '../types'
import { BUILTINS, ASCII_IDENT } from '../constants'

/** 保留字占用（变量/函数/参数/标签）+ 非 ASCII 标识符（变量/标签）。 */
export function checkIdentifiers(table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []

  const reserved = (name: string, file: string, line: number, what: string) => {
    if (BUILTINS.has(name)) {
      out.push({ severity: 'error', code: 'reserved-identifier', message: `内置函数名不可作${what}：「${name}」`, file, line })
    }
  }
  const ascii = (name: string, file: string, line: number, what: string) => {
    if (!ASCII_IDENT.test(name)) {
      out.push({ severity: 'error', code: 'non-ascii-identifier', message: `${what}必须是 ASCII 标识符：「${name}」`, file, line })
    }
  }

  for (const d of table.declarations) {
    reserved(d.name, d.file, d.line, '变量名')
    ascii(d.name, d.file, d.line, '变量名')
  }
  for (const p of table.params) {
    reserved(p.name, p.file, p.line, '参数名') // ASCII 由 parser 保证
  }
  for (const l of table.labels) {
    reserved(l.name, l.file, l.line, '选项标签')
    ascii(l.name, l.file, l.line, '选项标签')
  }
  return out
}
