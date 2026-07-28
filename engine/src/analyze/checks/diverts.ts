import { parse as acornParse } from 'acorn'
import type { ProjectFile, ContentBlock, Knot, Divert } from '../../parser/ast'
import type { Diagnostic, SymbolTable } from '../types'
import { openingKnotName } from '../opening'
import { visitBlockTree } from '../../parser/visit'
import type { AstNode } from '../../js-ast'

/** 表达式整体是否为单个字符串字面量；是则返回其值，否则 null（语法错也 null，交 js-syntax-error）。 */
function stringLiteralValue(code: string): string | null {
  let program: AstNode
  try {
    program = acornParse(`(${code})`, { ecmaVersion: 'latest' }) as AstNode
  } catch {
    return null
  }
  const stmt = program.body[0]
  if (!stmt || stmt.type !== 'ExpressionStatement') return null
  const e = stmt.expression
  return e.type === 'Literal' && typeof e.value === 'string' ? e.value : null
}

/** 跳转目标存在性 + 带参实参个数 + 非法进入带参节点子节点。 */
export function checkDiverts(files: ProjectFile[], table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []

  const authorKnot = (name: string) => {
    const k = table.knots.get(name)
    return k !== undefined && k.scope !== 'global' ? k : null
  }

  /**
   * `-> {"字面量"}` 直写：目标编译期已知，按运行时字符串档规则校验——只认 knot 名 / `父.子`
   * 全路径 / END/DONE（裸 stitch 不做同级相对解析）；带参 knot 拒（字符串无处带实参）；
   * 外部跳带参节点的 stitch 拒（与静态 param-knot-stitch-entry 同规则）。
   */
  const checkStringLiteralTarget = (t: string, host: Knot, file: string, line: number) => {
    if (t === 'END' || t === 'DONE') return
    const dot = t.indexOf('.')
    if (dot !== -1) {
      const parent = t.slice(0, dot)
      const child = t.slice(dot + 1)
      const knot = authorKnot(parent)
      if (knot === null || table.stitches.get(parent)?.has(child) !== true) {
        out.push({ severity: 'error', code: 'unknown-node', message: `节点不存在：「${t}」`, file, line })
        return
      }
      if (knot.params.length > 0 && parent !== host.name) {
        out.push({ severity: 'error', code: 'param-knot-stitch-entry', message: `不能从外部跳进带参节点「${parent}」的子节点（参数无从绑定）`, file, line })
      }
      return
    }
    const knot = authorKnot(t)
    if (knot === null) {
      out.push({ severity: 'error', code: 'unknown-node', message: `节点不存在：「${t}」`, file, line })
      return
    }
    if (knot.params.length > 0) {
      out.push({ severity: 'error', code: 'node-string-param', message: `带参节点「${t}」须经 $nodes.${t}(实参) 绑定实参后跳转（字符串目标无处带实参）`, file, line })
    }
  }

  const checkOne = (d: Divert, host: Knot, file: string) => {
    if (d.targetExpr !== undefined) {
      // 动态跳转：目标运行时才定，存在性检查跳过；表达式整体为字符串字面量时编译期即校验。
      const lit = stringLiteralValue(d.targetExpr)
      if (lit !== null) checkStringLiteralTarget(lit, host, file, d.line)
      return
    }
    const t = d.target
    if (t === 'END' || t === 'DONE') return

    const dot = t.indexOf('.')
    if (dot !== -1) {
      const parent = t.slice(0, dot)
      const child = t.slice(dot + 1)
      const knot = table.knots.get(parent)
      if (!knot || !table.stitches.get(parent)?.has(child)) {
        out.push({ severity: 'error', code: 'unknown-divert-target', message: `跳转目标不存在：「${t}」`, file, line: d.line })
        return
      }
      if (knot.params.length > 0 && parent !== host.name) {
        out.push({ severity: 'error', code: 'param-knot-stitch-entry', message: `不能从外部跳进带参节点「${parent}」的子节点（参数无从绑定）`, file, line: d.line })
      }
      // 子节点（stitch）不接受实参——只有 knot 有 params。实参被运行期静默吞掉、连副作用都不求值（A10）。
      if (d.args.length > 0) {
        out.push({ severity: 'error', code: 'stitch-no-args', message: `子节点「${t}」不接受实参（只有节点可带参数）`, file, line: d.line })
      }
      return
    }

    // 无 .：先全局 knots（knots 优先消歧），再宿主同级 stitch
    const knot = table.knots.get(t)
    if (knot) {
      if (d.args.length !== knot.params.length) {
        out.push({ severity: 'error', code: 'divert-arity', message: `跳转「${t}」实参 ${d.args.length} 个，节点需 ${knot.params.length} 个`, file, line: d.line })
      }
      return
    }
    if (table.stitches.get(host.name)?.has(t)) return // 同级子节点
    out.push({ severity: 'error', code: 'unknown-divert-target', message: `跳转目标不存在：「${t}」`, file, line: d.line })
  }

  // host / file 在一棵 knot 树内恒定，闭包捕获即可，无需线程化语境。
  const walk = (block: ContentBlock, host: Knot, file: string) =>
    visitBlockTree<void>(block, undefined, {
      element: (el) => {
        if (el.kind === 'divert') checkOne(el, host, file)
      },
      choice: (c) => {
        if (c.resultDivert !== null) checkOne(c.resultDivert, host, file)
      },
    })

  // 走每个文件的显式 knots + preamble（顶层开场）——parser 对 preamble 一视同仁产出
  // divert/choiceGroup，顶层开场里的坏跳转目标须一并静态诊断（A5）。preamble 的 host 用自建的
  // 开场 knot（不依赖 addOpeningKnots 先跑）：无参、无子节点，故 host.name 不撞任何作者 knot、
  // 同级子节点判定恒空——preamble 的裸跳转只能命中全局 knot，与运行期一致。
  for (const file of files) {
    if (file.preamble.length > 0) {
      const openingHost: Knot = {
        kind: 'knot', name: openingKnotName(file.path), params: [],
        body: file.preamble, stitches: [], line: file.preamble[0]!.line, scope: 'global',
      }
      walk(file.preamble, openingHost, file.path)
    }
    for (const knot of file.knots) {
      walk(knot.body, knot, file.path)
      for (const st of knot.stitches) walk(st.body, knot, file.path)
    }
  }
  return out
}
