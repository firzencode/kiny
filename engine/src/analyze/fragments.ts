import type { ProjectFile, ContentBlock, InlineSegment } from '../parser/ast'
import type { Scope } from './types'

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

  const walkBlock = (block: ContentBlock, scope: Scope) => {
    for (const el of block) {
      switch (el.kind) {
        case 'text':
          fromSegments(el.segments, el.line, scope)
          break
        case 'divert':
        case 'command':
          for (const a of el.args) pushExpr(a, el.line, scope)
          break
        case 'logicLine':
          pushStmt(el.code, el.line, scope)
          break
        case 'logicBlock':
          pushStmt(el.code, el.line, scope)
          break
        case 'choiceGroup':
          for (const c of el.choices) {
            if (c.condition !== null) pushExpr(c.condition, c.line, scope)
            fromSegments(c.before, c.line, scope)
            if (c.inner !== null) fromSegments(c.inner, c.line, scope)
            fromSegments(c.after, c.line, scope)
            if (c.resultDivert !== null) {
              for (const a of c.resultDivert.args) pushExpr(a, c.line, scope)
            }
            walkBlock(c.body, scope)
          }
          break
        case 'conditional':
          for (const b of el.branches) {
            if (b.condition !== null) pushExpr(b.condition, b.line, scope)
            walkBlock(b.body, scope)
          }
          break
        default: {
          const _exhaustive: never = el
          void _exhaustive
          break
        }
      }
    }
  }

  walkBlock(file.preamble, { kind: 'global' })
  for (const knot of file.knots) {
    const scope: Scope = { kind: 'knot', name: knot.name }
    walkBlock(knot.body, scope)
    for (const stitch of knot.stitches) walkBlock(stitch.body, scope)
  }
  return out
}
