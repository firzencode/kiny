import type { ProjectFile, Knot, Stitch, ContentBlock } from '../parser/ast'
import type { SymbolTable, DeclSite, LabelSite, ParamSite, FragmentInfo } from './types'
import { collectFragments } from './fragments'
import { analyzeJs } from './js-scope'

/** 纯建表：填 Map、收集出现记录、跑唯一一遍 acorn，派生查询集。不产诊断。 */
export function buildSymbolTable(files: ProjectFile[]): SymbolTable {
  const knots = new Map<string, Knot>()
  const stitches = new Map<string, Map<string, Stitch>>()
  const declarations: DeclSite[] = []
  const labels: LabelSite[] = []
  const params: ParamSite[] = []
  const fragments: FragmentInfo[] = []

  // 文件名字典序，保证合并确定性（§7.6）。
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  // 1) 节点 / 子节点 / 参数 / 标签 出现记录
  for (const file of sorted) {
    collectLabels(file.preamble, file.path, labels)
    for (const knot of file.knots) {
      if (!knots.has(knot.name)) knots.set(knot.name, knot)
      const sm = stitches.get(knot.name) ?? new Map<string, Stitch>()
      for (const st of knot.stitches) if (!sm.has(st.name)) sm.set(st.name, st)
      stitches.set(knot.name, sm)
      for (const p of knot.params) params.push({ name: p, file: file.path, line: knot.line, knot: knot.name })
      collectLabels(knot.body, file.path, labels)
      for (const st of knot.stitches) collectLabels(st.body, file.path, labels)
    }
  }

  // 2) JS 片段：每个片段一次 acorn
  for (const file of sorted) {
    for (const frag of collectFragments(file)) {
      const r = analyzeJs(frag.code, frag.mode)
      if ('error' in r) {
        fragments.push({ file: frag.file, line: frag.line, scope: frag.scope, references: [], syntaxError: r.error })
        continue
      }
      fragments.push({ file: frag.file, line: frag.line, scope: frag.scope, references: r.references, syntaxError: null })
      for (const name of r.declares) declarations.push({ name, file: frag.file, line: frag.line, scope: frag.scope })
    }
  }

  // 3) 派生查询集
  const globals = new Set<string>()
  const locals = new Map<string, Set<string>>()
  for (const d of declarations) {
    if (d.scope.kind === 'global') globals.add(d.name)
    else {
      const s = locals.get(d.scope.name) ?? new Set<string>()
      s.add(d.name)
      locals.set(d.scope.name, s)
    }
  }
  for (const p of params) {
    const s = locals.get(p.knot) ?? new Set<string>()
    s.add(p.name)
    locals.set(p.knot, s)
  }
  const labelSet = new Set(labels.map((l) => l.name))

  return { knots, stitches, declarations, labels, params, fragments, globals, locals, labelSet }
}

function collectLabels(block: ContentBlock, file: string, out: LabelSite[]): void {
  for (const el of block) {
    if (el.kind === 'choiceGroup') {
      for (const c of el.choices) {
        if (c.label !== null) out.push({ name: c.label, file, line: c.line })
        collectLabels(c.body, file, out)
      }
    } else if (el.kind === 'conditional') {
      for (const b of el.branches) collectLabels(b.body, file, out)
    }
  }
}
