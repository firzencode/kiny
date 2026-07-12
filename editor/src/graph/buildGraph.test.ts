import { describe, it, expect } from 'vitest'
import { parse, analyze } from '@kiny/engine'
import type { ProjectFile } from '@kiny/engine'
import { buildGraph, stitchId, END_ID, ownerKnotId } from './buildGraph'

/** 由若干 .kin 源构建 StoryGraph（走真实 parse + analyze，与 editor 生产路径一致）。 */
function build(sources: Record<string, string>, entry?: string) {
  const files: ProjectFile[] = Object.entries(sources).map(([path, src]) => parse(src, path))
  const { program, diagnostics } = analyze(files)
  return { graph: buildGraph(program, entry ?? null), program, diagnostics }
}

describe('buildGraph', () => {
  it('program 为 null（有校验错误）→ 空图', () => {
    const g = buildGraph(null)
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
  })

  it('每个 knot 成一个节点，stitch 作其子节点（文档顺序）', () => {
    const { graph } = build({
      'main.kin': [
        '-> 甲',
        '=== 甲 ===',
        '正文。',
        '= 子一',
        '子一正文。',
        '= 子二',
        '子二正文。',
        '-> END',
      ].join('\n'),
    })
    const jia = graph.nodes.find((n) => n.id === '甲')!
    expect(jia).toBeTruthy()
    expect(jia.kind).toBe('knot')
    expect(jia.stitches.map((s) => s.name)).toEqual(['子一', '子二'])
    expect(jia.stitches[0]!.id).toBe(stitchId('甲', '子一'))
    // 溯源：knot 行、stitch 行、file
    expect(jia.line).toBe(2)
    expect(jia.stitches[0]!.line).toBe(4)
    expect(jia.stitches[0]!.file).toBe('main.kin')
  })

  it('直接 divert 与 choice resultDivert 分类正确', () => {
    const { graph } = build({
      'main.kin': [
        '-> 甲',
        '=== 甲 ===',
        '* [去乙] -> 乙',
        '* [去丙] -> 丙',
        '=== 乙 ===',
        '-> 丙',
        '=== 丙 ===',
        '-> END',
      ].join('\n'),
    })
    const fromJia = graph.edges.filter((e) => ownerKnotId(e.from) === '甲')
    expect(fromJia).toHaveLength(2)
    expect(fromJia.every((e) => e.kind === 'choice')).toBe(true)
    expect(fromJia.map((e) => e.to).sort()).toEqual(['丙', '乙'])

    const fromYi = graph.edges.filter((e) => ownerKnotId(e.from) === '乙')
    expect(fromYi).toHaveLength(1)
    expect(fromYi[0]!.kind).toBe('divert')
    expect(fromYi[0]!.to).toBe('丙')
  })

  it('END / DONE 收敛为单一终端节点', () => {
    const { graph } = build({
      'main.kin': [
        '-> 甲',
        '=== 甲 ===',
        '* [a] -> END',
        '* [b] -> DONE',
        '=== 乙 ===',
        '-> END',
      ].join('\n'),
    })
    const ends = graph.nodes.filter((n) => n.kind === 'end')
    expect(ends).toHaveLength(1)
    expect(ends[0]!.id).toBe(END_ID)
    const toEnd = graph.edges.filter((e) => e.to === END_ID)
    expect(toEnd).toHaveLength(3)
    expect(toEnd.every((e) => e.resolved)).toBe(true)
  })

  it('knot.stitch 目标：跨 knot 边锚到具体 stitch', () => {
    const { graph } = build({
      'main.kin': [
        '-> 甲',
        '=== 甲 ===',
        '-> 乙.子',
        '=== 乙 ===',
        '正文。',
        '= 子',
        '-> END',
      ].join('\n'),
    })
    const e = graph.edges.find((x) => ownerKnotId(x.from) === '甲')!
    expect(e.resolved).toBe(true)
    expect(e.to).toBe(stitchId('乙', '子'))
  })

  it('无点目标：knots 优先于 host 同级 stitch 消歧', () => {
    // 甲 内跳 X：全局有 knot X 也有 甲.X 子节点 → 解析到 knot X（对齐 checkDiverts）
    const { graph } = build({
      'main.kin': [
        '-> 甲',
        '=== 甲 ===',
        '-> X',
        '= X',
        '-> END',
        '=== X ===',
        '-> END',
      ].join('\n'),
    })
    const e = graph.edges.find((x) => x.from === '甲' && x.line === 3)!
    expect(e.to).toBe('X') // knot X，而非 stitchId('甲','X')
    expect(e.resolved).toBe(true)
  })

  it('跨文件：knot 与其 file 溯源正确', () => {
    const { graph } = build({
      'main.kin': ['-> 甲', '=== 甲 ===', '-> 乙'].join('\n'),
      'other.kin': ['=== 乙 ===', '-> END'].join('\n'),
    })
    const yi = graph.nodes.find((n) => n.id === '乙')!
    expect(yi.file).toBe('other.kin')
    const e = graph.edges.find((x) => x.from === '甲')!
    expect(e.to).toBe('乙')
    expect(e.resolved).toBe(true)
  })

  it('合成开场 knot（preamble 非空）入图并标为 opening', () => {
    const { graph } = build(
      {
        'main.kin': ['开场白。', '-> 甲', '=== 甲 ===', '-> END'].join('\n'),
      },
      'main.kin',
    )
    const opening = graph.nodes.find((n) => n.isOpening)!
    expect(opening).toBeTruthy()
    expect(opening.name).toBe('（开场）')
    expect(opening.isEntry).toBe(true) // preamble 存在 → 开场 knot 为入口
  })

  it('入口给定时，BFS 不可达的 knot 标 unreachable', () => {
    const { graph } = build(
      {
        'main.kin': [
          '-> 甲',
          '=== 甲 ===',
          '-> END',
          '=== 孤岛 ===',
          '正文，无人跳来。',
          '-> END',
        ].join('\n'),
      },
      'main.kin',
    )
    const jia = graph.nodes.find((n) => n.id === '甲')!
    const island = graph.nodes.find((n) => n.id === '孤岛')!
    expect(jia.unreachable).toBe(false)
    expect(island.unreachable).toBe(true)
  })

  it('确定性：同输入两次构建结果一致', () => {
    const src = {
      'main.kin': ['-> 甲', '=== 甲 ===', '* [a] -> 乙', '=== 乙 ===', '-> END'].join('\n'),
    }
    const a = build(src, 'main.kin').graph
    const b = build(src, 'main.kin').graph
    expect(a).toEqual(b)
  })
})
