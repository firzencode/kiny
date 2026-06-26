import { describe, it, expect } from 'vitest'
import type { ValidatedProgram, Knot } from '@kiny/engine'
import { divertTargetAt, resolveTarget, computeFoldRange } from './navigate'

describe('divertTargetAt（光标落在 -> 目标上）', () => {
  it('光标在目标名内 → 返回目标', () => {
    const line = '* 去码头 -> 码头'
    const col = line.indexOf('码头', line.indexOf('->'))
    expect(divertTargetAt(line, col)).toBe('码头')
  })
  it('节点.子节点目标', () => {
    const line = '-> 码头.北岸'
    expect(divertTargetAt(line, line.length)).toBe('码头.北岸')
  })
  it('光标不在目标上 → null', () => {
    expect(divertTargetAt('普通正文没有跳转', 2)).toBeNull()
  })
})

// 构造最小 ValidatedProgram（只填解析用到的 files/knots）。
function prog(files: { path: string; knots: Partial<Knot>[] }[]): ValidatedProgram {
  return {
    files: files.map((f) => ({ path: f.path, preamble: [], richTextIssues: [], knots: f.knots as Knot[] })),
    knots: new Map(),
    stitches: new Map(),
    globals: new Set(),
    locals: new Map(),
    labels: new Set(),
  }
}

describe('resolveTarget（目标 → 文件 + 行）', () => {
  const p = prog([
    { path: 'main.kin', knots: [{ name: '开场', line: 1, stitches: [] }] },
    { path: 'port.kin', knots: [{ name: '码头', line: 3, stitches: [{ name: '北岸', line: 7 } as Knot['stitches'][number]] }] },
  ])
  it('跨文件节点 → 目标文件 + 节点行', () => {
    expect(resolveTarget('码头', p)).toEqual({ file: 'port.kin', line: 3 })
  })
  it('节点.子节点 → 子节点行', () => {
    expect(resolveTarget('码头.北岸', p)).toEqual({ file: 'port.kin', line: 7 })
  })
  it('子节点不存在 → 退回节点行', () => {
    expect(resolveTarget('码头.无此', p)).toEqual({ file: 'port.kin', line: 3 })
  })
  it('未知目标 → null', () => {
    expect(resolveTarget('幽灵节点', p)).toBeNull()
  })
})

describe('computeFoldRange（节点头折叠范围）', () => {
  const src = [
    '=== 开场 ===', // 1
    '正文1', // 2
    '正文2', // 3
    '', // 4
    '=== 码头 ===', // 5
    '正文3', // 6
  ].join('\n')

  it('节点头折叠到下一个节点头前的末体行（去尾空行）', () => {
    expect(computeFoldRange(src, 1)).toEqual({ fromLine: 1, toLine: 3 })
  })
  it('末节点折叠到文件尾', () => {
    expect(computeFoldRange(src, 5)).toEqual({ fromLine: 5, toLine: 6 })
  })
  it('非节点头行 → null', () => {
    expect(computeFoldRange(src, 2)).toBeNull()
  })
  it('空体节点 → null', () => {
    expect(computeFoldRange('=== A ===\n=== B ===\n体', 1)).toBeNull()
  })

  it('子节点 = 名 折叠到下个子节点头', () => {
    const s = ['=== 开场 ===', '= 北岸', '正文a', '正文b', '= 南岸', '正文c'].join('\n')
    expect(computeFoldRange(s, 2)).toEqual({ fromLine: 2, toLine: 4 })
  })
})
