import type { Diagnostic, SymbolTable, Scope } from '../types'
import { BUILTINS, JS_GLOBALS, RESERVED_NAMES } from '../constants'

/** 未声明变量 + 跨文件全局重复声明 + JS 片段语法错误。 */
export function checkVariables(table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []

  // 保留名（$nodes）：声明即报——它是引擎注入的只读节点表，覆盖声明会遮蔽内置。
  for (const d of table.declarations) {
    if (RESERVED_NAMES.has(d.name)) {
      out.push({ severity: 'error', code: 'reserved-name', message: `「${d.name}」是引擎保留名，不能声明或赋值`, file: d.file, line: d.line })
    }
  }

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
    const set = new Set<string>([...table.globals, ...BUILTINS, ...RESERVED_NAMES, ...table.labelSet, ...JS_GLOBALS])
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
    // 给内置函数赋值（`~ random = 5` / `random++`）→ error：B 是实例级共享层，一次手滑
    // 赋值会永久破坏该 Story 的内置函数，运行期在远处炸「random is not a function」（A7）。
    for (const name of frag.assigns) {
      if (BUILTINS.has(name)) {
        out.push({ severity: 'error', code: 'assign-builtin', message: `不能给内置函数赋值：「${name}」`, file: frag.file, line: frag.line })
      }
      if (RESERVED_NAMES.has(name)) {
        out.push({ severity: 'error', code: 'reserved-name', message: `「${name}」是引擎保留名，不能声明或赋值`, file: frag.file, line: frag.line })
      }
    }
  }
  return out
}
