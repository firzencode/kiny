import type { ProjectFile, ContentBlock, InlineSegment } from '../parser/ast'
import type { Scope } from './types'
import { visitBlockTree } from '../parser/visit'

export interface RawFragment {
  code: string
  file: string
  line: number
  scope: Scope
  mode: 'expr' | 'stmt'
}

/** 走查一个文件，收集全部 JS 片段。 */
export function collectFragments(file: ProjectFile): RawFragment[] {
  const out: RawFragment[] = []
  const path = file.path

  const pushExpr = (code: string, line: number, scope: Scope) =>
    out.push({ code, file: path, line, scope, mode: 'expr' })
  const pushStmt = (code: string, line: number, scope: Scope) =>
    out.push({ code, file: path, line, scope, mode: 'stmt' })

  const fromSegments = (segs: InlineSegment[], line: number, scope: Scope) => {
    for (const s of segs) if (s.kind === 'interp') pushExpr(s.code, line, scope)
  }

  // scope 在一棵 knot 树内恒定，闭包捕获即可。叶元素在 element、choice/branch 的内联片段在对应钩子提取，
  // choiceGroup/conditional 的下钻交给 visitBlockTree。
  const walkBlock = (block: ContentBlock, scope: Scope) =>
    visitBlockTree<void>(block, undefined, {
      element: (el) => {
        switch (el.kind) {
          case 'text':
            fromSegments(el.segments, el.line, scope)
            break
          case 'divert':
          case 'command':
            for (const a of el.args) pushExpr(a, el.line, scope)
            if (el.kind === 'divert' && el.targetExpr !== undefined) pushExpr(el.targetExpr, el.line, scope)
            break
          case 'logicLine':
          case 'logicBlock':
            pushStmt(el.code, el.line, scope)
            break
        }
      },
      choice: (c) => {
        if (c.condition !== null) pushExpr(c.condition, c.line, scope)
        fromSegments(c.before, c.line, scope)
        if (c.inner !== null) fromSegments(c.inner, c.line, scope)
        fromSegments(c.after, c.line, scope)
        if (c.resultDivert !== null) {
          for (const a of c.resultDivert.args) pushExpr(a, c.line, scope)
          if (c.resultDivert.targetExpr !== undefined) pushExpr(c.resultDivert.targetExpr, c.line, scope)
        }
      },
      branch: (b) => {
        if (b.condition !== null) pushExpr(b.condition, b.line, scope)
      },
    })

  walkBlock(file.preamble, { kind: 'global' })
  for (const knot of file.knots) {
    const scope: Scope = { kind: 'knot', name: knot.name }
    walkBlock(knot.body, scope)
    for (const stitch of knot.stitches) walkBlock(stitch.body, scope)
  }
  return out
}
