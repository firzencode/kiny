import type { Diagnostic, SymbolTable, Scope } from '../types'
import { BUILTINS, JS_GLOBALS } from '../constants'

/** 未声明变量 + 跨文件全局重复声明 + JS 片段语法错误。 */
export function checkVariables(table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []

  // duplicate-global：global 作用域声明名出现多次
  const seenGlobal = new Set<string>()
  for (const d of table.declarations) {
    if (d.scope.kind !== 'global') continue
    if (seenGlobal.has(d.name)) {
      out.push({ severity: 'error', code: 'duplicate-global', message: `全局变量/函数重复声明：「${d.name}」`, file: d.file, line: d.line })
    } else {
      seenGlobal.add(d.name)
    }
  }

  const allowedFor = (scope: Scope): Set<string> => {
    const set = new Set<string>([...table.globals, ...BUILTINS, ...table.labelSet, ...JS_GLOBALS])
    if (scope.kind === 'knot') for (const n of table.locals.get(scope.name) ?? []) set.add(n)
    return set
  }

  for (const frag of table.fragments) {
    if (frag.syntaxError !== null) {
      out.push({ severity: 'error', code: 'js-syntax-error', message: `JS 片段语法错误：${frag.syntaxError}`, file: frag.file, line: frag.line })
      continue
    }
    const allowed = allowedFor(frag.scope)
    for (const ref of frag.references) {
      if (!allowed.has(ref)) {
        out.push({ severity: 'error', code: 'undeclared-var', message: `引用未声明的变量：「${ref}」`, file: frag.file, line: frag.line })
      }
    }
  }
  return out
}
