import type { ProjectFile, ContentBlock } from '../../parser/ast'
import type { Diagnostic } from '../types'
import { COMMAND_NAMES, ASCII_IDENT, BUILTINS } from '../constants'
import { visitBlockTree } from '../../parser/visit'

/** 未知 @命令 + `@input` 形态特判（元数：变量存在性由 checkVariables 经片段引用检查覆盖）。 */
export function checkCommands(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []
  const walk = (block: ContentBlock, file: string) =>
    visitBlockTree<void>(block, undefined, {
      element: (el) => {
        if (el.kind !== 'command') return
        if (!COMMAND_NAMES.has(el.name)) {
          out.push({ severity: 'error', code: 'unknown-command', message: `未知命令：@${el.name}`, file, line: el.line })
        } else if (el.name === 'input') {
          // @input(变量名 [, 提示])：第一参是左值（变量名，裸标识符），是规则的显式例外（其它命令参数皆右值表达式）。
          // 参数个数 1–2；arg0 须为裸标识符。变量「已声明」由 checkVariables 覆盖——命令 args 经
          // collectFragments 作 expr 引用收集，未声明变量会另报 undeclared-var，故此处不重复查符号表。
          if (el.args.length < 1 || el.args.length > 2) {
            out.push({ severity: 'error', code: 'input-arity', message: `@input 需要 1 或 2 个参数（变量名 [, 提示]）`, file, line: el.line })
          } else if (!ASCII_IDENT.test(el.args[0]!)) {
            out.push({ severity: 'error', code: 'input-target', message: `@input 第一个参数必须是变量名（裸标识符）`, file, line: el.line })
          } else if (BUILTINS.has(el.args[0]!)) {
            // @input(random) 会把内置函数名当变量写入 → 破坏该 Story 的内置函数（同 A7 赋值）。
            out.push({ severity: 'error', code: 'input-target-builtin', message: `@input 的目标变量名不能是内置函数名：「${el.args[0]}」`, file, line: el.line })
          }
        }
      },
    })
  for (const file of files) {
    walk(file.preamble, file.path)
    for (const knot of file.knots) {
      walk(knot.body, file.path)
      for (const st of knot.stitches) walk(st.body, file.path)
    }
  }
  return out
}
