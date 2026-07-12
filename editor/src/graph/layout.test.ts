import { describe, it, expect } from 'vitest'
import { parse, analyze } from '@kiny/engine'
import type { ProjectFile } from '@kiny/engine'
import { buildGraph } from './buildGraph'
import { layout } from './layout'

function graphOf(sources: Record<string, string>, entry?: string) {
  const files: ProjectFile[] = Object.entries(sources).map(([path, src]) => parse(src, path))
  const { program } = analyze(files)
  return buildGraph(program, entry ?? null)
}

describe('layout', () => {
  it('空图 → 空布局', () => {
    const l = layout({ nodes: [], edges: [] })
    expect(l.nodes).toEqual([])
    expect(l.edges).toEqual([])
    expect(l.width).toBe(0)
  })

  it('线性 甲→乙→丙 逐层递增', () => {
    const g = graphOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '-> 乙', '=== 乙 ===', '-> 丙', '=== 丙 ===', '-> END'].join('\n'),
    })
    const l = layout(g)
    const layerOf = (id: string) => l.nodes.find((n) => n.id === id)!.layer
    // preamble `-> 甲` 会合成开场 knot（layer 0）→ 甲/乙/丙 顺次递增
    expect(layerOf('乙')).toBe(layerOf('甲') + 1)
    expect(layerOf('丙')).toBe(layerOf('乙') + 1)
    // END 在最后一层
    expect(layerOf('END')).toBeGreaterThan(layerOf('丙'))
    // x 坐标随层递增
    expect(l.nodes.find((n) => n.id === '乙')!.x).toBeGreaterThan(l.nodes.find((n) => n.id === '甲')!.x)
  })

  it('有环 甲→乙→甲：仍能分层，回边被标记', () => {
    const g = graphOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '-> 乙', '=== 乙 ===', '-> 甲'].join('\n'),
    })
    const l = layout(g)
    // 两节点都在图里
    expect(l.nodes.find((n) => n.id === '甲')).toBeTruthy()
    expect(l.nodes.find((n) => n.id === '乙')).toBeTruthy()
    // 恰有一条回边（乙→甲）
    const backs = l.edges.filter((e) => e.backEdge)
    expect(backs.length).toBeGreaterThanOrEqual(1)
    const b = backs.find((e) => e.from === '乙' && e.to === '甲')
    expect(b).toBeTruthy()
  })

  it('确定性：同图两次布局结果一致', () => {
    const g = graphOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '* [a] -> 乙', '* [b] -> 丙', '=== 乙 ===', '-> END', '=== 丙 ===', '-> END'].join('\n'),
    })
    expect(layout(g)).toEqual(layout(g))
  })

  it('resolved 边有折线锚点，未解析边甩残桩', () => {
    const g = graphOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '-> 乙', '=== 乙 ===', '-> END'].join('\n'),
    })
    const l = layout(g)
    const e = l.edges.find((x) => x.from === '甲' && x.to === '乙')!
    expect(e.points).toHaveLength(2)
    expect(e.points[0]!.x).toBeLessThan(e.points[1]!.x) // 从右锚甩向下一层左锚
  })

  it('stitch 目标边锚到子节点行高（非 knot 头）', () => {
    const g = graphOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '-> 乙.子', '=== 乙 ===', '头部。', '= 头', '正文', '= 子', '-> END'].join('\n'),
    })
    const l = layout(g)
    const yi = l.nodes.find((n) => n.id === '乙')!
    const sub = yi.laidStitches.find((s) => s.name === '子')!
    const e = l.edges.find((x) => x.from === '甲')!
    // toAnchor 落在子节点行中线，而非 knot 头中线
    expect(e.points[1]!.y).toBeCloseTo(sub.y + sub.h / 2, 1)
    expect(e.points[1]!.y).not.toBeCloseTo(yi.y + yi.h / 2, 1)
  })

  it('collapseStitches 折叠子节点明细', () => {
    const g = graphOf({
      'main.kin': ['-> 甲', '=== 甲 ===', '= 子一', '正文', '= 子二', '正文', '-> END'].join('\n'),
    })
    const full = layout(g)
    const collapsed = layout(g, { collapseStitches: true })
    const jiaFull = full.nodes.find((n) => n.id === '甲')!
    const jiaCol = collapsed.nodes.find((n) => n.id === '甲')!
    expect(jiaFull.laidStitches.length).toBe(2)
    expect(jiaCol.laidStitches.length).toBe(0)
    expect(jiaCol.h).toBeLessThan(jiaFull.h) // 折叠后更矮
  })
})
