import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { enumerateChoices, fingerprint, buildBlockPaths, resolveBlock } from './snapshot'
import type { Conditional } from '../parser/ast'

function prog(src: string) {
  const p = analyze([parse(src, 'main.kin')]).program
  if (!p) throw new Error('analyze 有 error，fixture 不合法')
  return p
}

describe('snapshot 节点枚举', () => {
  it('按确定顺序枚举所有 choice，index 与 list 下标一致', () => {
    const src = ['=== A ===', '* 选项一 -> END', '* 选项二 -> END', '* 选项三 -> END'].join('\n')
    const { list, index } = enumerateChoices(prog(src))
    expect(list.length).toBe(3)
    expect(index.get(list[0]!)).toBe(0)
    expect(index.get(list[1]!)).toBe(1)
    expect(index.get(list[2]!)).toBe(2)
  })

  it('同一 program 两次枚举 choice 数一致', () => {
    const src = ['=== A ===', '* x -> B', '* y -> B', '=== B ===', '* z -> END', '* w -> END'].join('\n')
    const a = enumerateChoices(prog(src)).list.length
    const b = enumerateChoices(prog(src)).list.length
    expect(a).toBe(b)
    expect(a).toBe(4)
  })
})

describe('snapshot 指纹', () => {
  it('同 program 指纹稳定', () => {
    const src = ['=== A ===', '* x -> END', '* y -> END'].join('\n')
    expect(fingerprint(prog(src))).toBe(fingerprint(prog(src)))
  })
  it('删一个选项后指纹变化', () => {
    const a = fingerprint(prog(['=== A ===', '* x -> END', '* y -> END'].join('\n')))
    const b = fingerprint(prog(['=== A ===', '* x -> END'].join('\n')))
    expect(a).not.toBe(b)
  })
})

describe('snapshot 栈帧 block 路径', () => {
  it('根帧 block（knot.body）路径 steps 为空，往返取回同一引用', () => {
    const program = prog(['=== A ===', '文本', '-> END'].join('\n'))
    const knot = program.knots.get('A')!
    const paths = buildBlockPaths(program)
    const p = paths.get(knot.body)!
    expect(p).toEqual({ root: { knot: 'A' }, steps: [] })
    expect(resolveBlock(program, p)).toBe(knot.body)
  })

  it('conditional 分支 body 路径 via+branch，往返取回同一引用', () => {
    const program = prog(['~ let m = 0', '=== A ===', '@if {m === 0}', '> 第一次', '@else', '> 又见', '-> END'].join('\n'))
    const knot = program.knots.get('A')!
    const cond = knot.body.find((e) => e.kind === 'conditional') as Conditional
    expect(cond.kind).toBe('conditional')
    const branch0 = cond.branches[0]!.body
    const via = knot.body.indexOf(cond)
    const paths = buildBlockPaths(program)
    const p = paths.get(branch0)!
    expect(p.root).toEqual({ knot: 'A' })
    expect(p.steps).toEqual([{ via, pick: { branch: 0 } }])
    expect(resolveBlock(program, p)).toBe(branch0)
  })
})
