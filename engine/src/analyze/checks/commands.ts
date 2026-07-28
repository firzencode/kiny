import type { ProjectFile, ContentBlock } from '../../parser/ast'
import type { Diagnostic } from '../types'
import { COMMAND_NAMES, ASCII_IDENT, BUILTINS } from '../constants'
import { PANEL_SLOTS } from '../../runtime/types'
import { visitBlockTree } from '../../parser/visit'

/** 字符串字面量（单 / 双引号，无转义时的朴素形态）；返回其值，非字面量返回 null。 */
function stringLiteral(raw: string): string | null {
  const s = raw.trim()
  const m = /^'([^'\\]*)'$|^"([^"\\]*)"$/.exec(s)
  if (!m) return null
  return m[1] ?? m[2] ?? ''
}

/** 数字字面量（整数 / 小数，可带正负号）。 */
const NUMBER_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
/** 非数字的其它字面量（字符串 / 布尔 / null）——这些写在期待数字的位置就是笔误，可静态拦。 */
const NON_NUMBER_LITERAL = /^(?:'[^']*'|"[^"]*"|`[^`]*`|true|false|null)$/
/** 非字符串的字面量（数字 / 布尔 / null）——写在期待字符串的位置就是笔误。 */
const NON_STRING_LITERAL = /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)|true|false|null)$/

/**
 * 期待「非负毫秒数」的参数是否可静态判负。
 * 返回 'ok'（合法字面量）/ 'bad'（字面量但非非负数字）/ 'dynamic'（表达式，留待运行期兜底）。
 */
function checkMillis(raw: string): 'ok' | 'bad' | 'dynamic' {
  const s = raw.trim()
  if (NUMBER_LITERAL.test(s)) return Number(s) >= 0 ? 'ok' : 'bad'
  if (NON_NUMBER_LITERAL.test(s)) return 'bad'
  return 'dynamic'
}

/** 未知 @命令 + `@input` / `@sleep` 形态特判（元数：变量存在性由 checkVariables 经片段引用检查覆盖）。 */
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
        } else if (el.name === 'sleep') {
          // @sleep(毫秒)：恰 1 参；字面量须为非负数字（写错当场报），表达式参不拦——
          // 运行期由 player 兜底（非数 / 负按 0 处理并 warn）。
          if (el.args.length !== 1) {
            out.push({ severity: 'error', code: 'sleep-arity', message: `@sleep 需要 1 个参数（毫秒）`, file, line: el.line })
          } else if (checkMillis(el.args[0]!) === 'bad') {
            out.push({ severity: 'error', code: 'sleep-duration', message: `@sleep 的时长必须是非负毫秒数：「${el.args[0]!.trim()}」`, file, line: el.line })
          }
        } else if (el.name === 'panel') {
          // @panel(槽位, 模板)：恰 2 参；槽位**须字符串字面量**且在三槽之内（引擎据此登记，不能运行期才知道）；
          // 模板为字面量时须是字符串（写成数字 / 布尔是笔误），表达式参不拦。
          if (el.args.length !== 2) {
            out.push({ severity: 'error', code: 'panel-arity', message: `@panel 需要 2 个参数（槽位, 模板）`, file, line: el.line })
          } else {
            const slot = stringLiteral(el.args[0]!)
            if (slot === null) {
              out.push({ severity: 'error', code: 'panel-slot', message: `@panel 的槽位必须是字符串字面量（${PANEL_SLOTS.map((s) => `"${s}"`).join(' / ')}）`, file, line: el.line })
            } else if (!(PANEL_SLOTS as readonly string[]).includes(slot)) {
              out.push({ severity: 'error', code: 'panel-slot', message: `未知的面板槽位「${slot}」，只能是 ${PANEL_SLOTS.map((s) => `"${s}"`).join(' / ')}`, file, line: el.line })
            }
            const tpl = el.args[1]!.trim()
            if (stringLiteral(el.args[1]!) === null && NON_STRING_LITERAL.test(tpl)) {
              out.push({ severity: 'error', code: 'panel-template', message: `@panel 的模板必须是字符串：「${tpl}」`, file, line: el.line })
            }
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
