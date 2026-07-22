import { parse as acornParse } from 'acorn'
import type { ProjectFile } from '../../parser/ast'
import type { AstNode } from '../../js-ast'
import type { Diagnostic } from '../types'

// 仍不可 JSON 化保真的内置构造：其内容不可枚举、无法编码，存档往返后丢失玩家累积状态。
// Map / Set / Date 已由快照白名单编解码保真（T076），移出告警集——否则误导作者「会丢」。
const NON_JSON_CTORS = new Set(['WeakMap', 'WeakSet'])

/** init 若为直接的 `new X()` 且 X 是已知不可 JSON 化构造，返回构造名，否则 null（保守：只认字面 NewExpression）。 */
function nonJsonCtorName(init: AstNode | null | undefined): string | null {
  if (!init || init.type !== 'NewExpression') return null
  if (!init.callee || init.callee.type !== 'Identifier') return null
  return NON_JSON_CTORS.has(init.callee.name) ? init.callee.name : null
}

/**
 * 全局作用域（preamble 的 ~ / ~~~）里声明的值若为 `new Map()` / `new Set()` / `new Date()` 等
 * 不可 JSON 化构造 → warning：这类值存档时会失真、读者读档后丢失过程中累积的状态。
 * 仅检测顶层**声明**（let/const/var X = new X()）的直接 `new` 初值；漏报可接受——它是提示而非保证。
 * 函数声明（restore 已能重建）、局部作用域的值（不进快照 globals）不检测。彻底方案待 issue IK1UE4。
 */
export function checkNonJsonGlobals(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const file of files) {
    for (const el of file.preamble) {
      if (el.kind !== 'logicLine' && el.kind !== 'logicBlock') continue
      let program: AstNode
      try {
        program = acornParse(el.code, { ecmaVersion: 'latest', locations: true }) as AstNode
      } catch {
        continue // 语法错误由 checkVariables 报，此处跳过
      }
      // code 首行对应的文件行：logicLine 即 el.line；logicBlock 的 el.line 是 `~~~` 栅栏行，正文自下一行起。
      const codeStartLine = el.kind === 'logicBlock' ? el.line + 1 : el.line
      for (const stmt of program.body) {
        if (stmt.type !== 'VariableDeclaration') continue
        for (const d of stmt.declarations) {
          const ctor = nonJsonCtorName(d.init)
          if (!ctor) continue
          const name = d.id?.type === 'Identifier' ? d.id.name : '?'
          // acorn loc 行号从 1 起（相对 code 首行），叠加 codeStartLine 得声明所在真实文件行。
          const line = codeStartLine + (d.init.loc ? d.init.loc.start.line - 1 : 0)
          out.push({
            severity: 'warning',
            code: 'non-json-global',
            message: `全局变量「${name}」的初值 new ${ctor}() 不是 JSON 值，存档时会失真、读者读档后丢失累积状态（重置为初始值）。改用普通对象 / 数组可正常存档。`,
            file: file.path,
            line,
          })
        }
      }
    }
  }
  return out
}
