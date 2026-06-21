import type { ProjectFile, ContentBlock, Knot, Divert } from '../../parser/ast'
import type { Diagnostic, SymbolTable } from '../types'

/** 跳转目标存在性 + 带参实参个数 + 非法进入带参节点子节点。 */
export function checkDiverts(files: ProjectFile[], table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []

  const checkOne = (d: Divert, host: Knot, file: string) => {
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

  const walk = (block: ContentBlock, host: Knot, file: string) => {
    for (const el of block) {
      switch (el.kind) {
        case 'divert':
          checkOne(el, host, file)
          break
        case 'choiceGroup':
          for (const c of el.choices) {
            if (c.resultDivert !== null) checkOne(c.resultDivert, host, file)
            walk(c.body, host, file)
          }
          break
        case 'conditional':
          for (const b of el.branches) walk(b.body, host, file)
          break
      }
    }
  }

  // preamble 不含跳转（跳转只在节点体内），故只走 knots。
  for (const file of files) {
    for (const knot of file.knots) {
      walk(knot.body, knot, file.path)
      for (const st of knot.stitches) walk(st.body, knot, file.path)
    }
  }
  return out
}
