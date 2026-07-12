import { openingKnotName, resolveStart } from '@kiny/engine'
import type { ValidatedProgram, Knot, ContentBlock, Divert } from '@kiny/engine'

/** 边的两类：直接 `->` 跳转 vs 源自选项 `resultDivert` 的分支。 */
export type EdgeKind = 'divert' | 'choice'

/** 图中一个 stitch 子节点（挂在其 knot 容器内）。 */
export interface GraphStitch {
  /** 稳定 id：`${knotId}::${stitchName}`。 */
  id: string
  name: string
  knotId: string
  line: number
  file: string
}

/** 图节点：一个 knot 容器，或所有 END/DONE 收敛成的单一终端。 */
export interface GraphNode {
  /** knot 名（含合成开场 knot 的保留名 ` opening:<path>`）或 `'END'`。 */
  id: string
  kind: 'knot' | 'end'
  /** 展示名：开场 knot → `（开场）`，其余同 id。 */
  name: string
  isOpening: boolean
  /** 是否入口起点（resolveStart 命中）。 */
  isEntry: boolean
  /** 从入口 BFS 不可达（有入口时才判定，否则恒 false）。 */
  unreachable: boolean
  line: number
  file: string
  stitches: GraphStitch[]
}

/** 一条跳转边。from/to 为节点 id 或 stitch id；未解析时 to 为原始 target 串。 */
export interface GraphEdge {
  id: string
  /** 源锚点：knot id（knot 体内直接 divert）或 stitch id（stitch 体内 divert）。 */
  from: string
  /** 目标：knot id / stitch id / `'END'`；未解析（resolved=false）时为原始 target。 */
  to: string
  kind: EdgeKind
  /** 源 divert 所在行。 */
  line: number
  resolved: boolean
  /** 原始 target 字符串（诊断/悬浮展示用）。 */
  target: string
}

export interface StoryGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const END_ID = 'END'
const STITCH_SEP = '::'

/** stitch 的稳定 id。 */
export function stitchId(knotId: string, stitch: string): string {
  return knotId + STITCH_SEP + stitch
}

/** 从节点/子节点 id 取其所属 knot id（END 归自身）。 */
export function ownerKnotId(id: string): string {
  if (id === END_ID) return END_ID
  const i = id.indexOf(STITCH_SEP)
  return i === -1 ? id : id.slice(0, i)
}

/**
 * 由已验证的项目符号表构建剧情结构图（纯函数，确定性）。
 *
 * - 节点 = 全部 knot（含合成开场 knot），内含其 stitch 子节点；END/DONE 收敛为单一终端节点。
 * - 边 = walk 每个 knot/stitch 体（含 choice 分支体、conditional 分支体）收集的 `Divert` 与
 *   `Choice.resultDivert`；target 解析规则对齐 engine 的 checkDiverts（knots 优先消歧、host 同级 stitch）。
 * - `program` 为 null（校验有 error）→ 空图。
 */
export function buildGraph(program: ValidatedProgram | null, entryPath?: string | null): StoryGraph {
  if (!program) return { nodes: [], edges: [] }

  const knots = program.knots // Map<name, Knot>，含合成开场 knot
  const stitches = program.stitches // Map<knotName, Map<stitchName, Stitch>>

  // AST 无 file 字段：从 files 反推 knot→file（开场 knot 按其路径）。
  const knotFile = new Map<string, string>()
  for (const file of program.files) {
    for (const k of file.knots) knotFile.set(k.name, file.path)
    if (file.preamble.length > 0) knotFile.set(openingKnotName(file.path), file.path)
  }

  const entryName = entryPath ? resolveStart(program, entryPath) : null

  // ---- 节点 ----
  const nodes: GraphNode[] = []
  const nodeIds = new Set<string>()
  for (const [name, knot] of knots) {
    const isOpening = knot.scope === 'global'
    const file = knotFile.get(name) ?? ''
    const stList: GraphStitch[] = knot.stitches.map((st) => ({
      id: stitchId(name, st.name),
      name: st.name,
      knotId: name,
      line: st.line,
      file,
    }))
    nodes.push({
      id: name,
      kind: 'knot',
      name: isOpening ? '（开场）' : name,
      isOpening,
      isEntry: name === entryName,
      unreachable: false,
      line: knot.line,
      file,
      stitches: stList,
    })
    nodeIds.add(name)
  }

  // ---- 边 ----
  const edges: GraphEdge[] = []
  let seq = 0
  let hasEnd = false

  // target 解析：对齐 engine/src/analyze/checks/diverts.ts 的 checkOne 规则。
  const resolveTarget = (t: string, hostName: string): { to: string; resolved: boolean } => {
    if (t === 'END' || t === 'DONE') return { to: END_ID, resolved: true }
    const dot = t.indexOf('.')
    if (dot !== -1) {
      const parent = t.slice(0, dot)
      const child = t.slice(dot + 1)
      if (knots.has(parent) && stitches.get(parent)?.has(child)) {
        return { to: stitchId(parent, child), resolved: true }
      }
      return { to: t, resolved: false }
    }
    if (knots.has(t)) return { to: t, resolved: true } // knots 优先消歧
    if (stitches.get(hostName)?.has(t)) return { to: stitchId(hostName, t), resolved: true } // 同级子节点
    return { to: t, resolved: false }
  }

  const addEdge = (d: Divert, from: string, hostName: string, kind: EdgeKind) => {
    const { to, resolved } = resolveTarget(d.target, hostName)
    if (resolved && to === END_ID) hasEnd = true
    edges.push({ id: 'e' + seq++, from, to, kind, line: d.line, resolved, target: d.target })
  }

  const walk = (block: ContentBlock, from: string, hostName: string) => {
    for (const el of block) {
      switch (el.kind) {
        case 'divert':
          addEdge(el, from, hostName, 'divert')
          break
        case 'choiceGroup':
          for (const c of el.choices) {
            if (c.resultDivert) addEdge(c.resultDivert, from, hostName, 'choice')
            walk(c.body, from, hostName)
          }
          break
        case 'conditional':
          for (const b of el.branches) walk(b.body, from, hostName)
          break
      }
    }
  }

  for (const [name, knot] of knots) {
    walk(knot.body, name, name)
    for (const st of knot.stitches) walk(st.body, stitchId(name, st.name), name)
  }

  if (hasEnd) {
    nodes.push({
      id: END_ID,
      kind: 'end',
      name: 'END',
      isOpening: false,
      isEntry: false,
      unreachable: false,
      line: 0,
      file: '',
      stitches: [],
    })
    nodeIds.add(END_ID)
  }

  // ---- 可达性（knot 粒度 BFS，仅在有入口时判定）----
  if (entryName && nodeIds.has(entryName)) {
    const adj = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!e.resolved || e.to === END_ID) continue
      const a = ownerKnotId(e.from)
      const b = ownerKnotId(e.to)
      if (!adj.has(a)) adj.set(a, new Set())
      adj.get(a)!.add(b)
    }
    const seen = new Set<string>([entryName])
    const queue = [entryName]
    while (queue.length) {
      const cur = queue.shift()!
      for (const nb of adj.get(cur) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb)
          queue.push(nb)
        }
      }
    }
    for (const node of nodes) {
      if (node.kind === 'knot' && !seen.has(node.id)) node.unreachable = true
    }
  }

  return { nodes, edges }
}

// 供测试引用（避免魔法值散落）。
export type { Knot }
