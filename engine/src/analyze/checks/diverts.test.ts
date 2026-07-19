import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { buildSymbolTable } from '../symbols'
import { checkDiverts } from './diverts'

const run = (...srcs: string[]) => {
  const files = srcs.map((s, i) => parse(s, `f${i}.kin`))
  return checkDiverts(files, buildSymbolTable(files))
}

describe('checkDiverts', () => {
  it('正例：存在的目标、END、同级子节点零诊断', () => {
    const src = ['=== A ===', '-> B', '=== B ===', '-> b1', '= b1', '-> END'].join('\n')
    expect(run(src)).toEqual([])
  })
  it('未知目标报 unknown-divert-target', () => {
    const ds = run('=== A ===\n-> 不存在')
    expect(ds.map((d) => d.code)).toContain('unknown-divert-target')
  })
  it('带参实参个数不符报 divert-arity', () => {
    const src = ['=== A ===', '-> 店("酒")', '=== 店(cat, disc) ===', '-> END'].join('\n')
    const ds = run(src)
    expect(ds.map((d) => d.code)).toContain('divert-arity')
  })
  it('无参节点带实参报 divert-arity', () => {
    const ds = run('=== A ===\n-> B(1)\n=== B ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('divert-arity')
  })
  it('跨父跳子节点用 父.子 路径', () => {
    const src = ['=== A ===', '-> B.b1', '=== B ===', '-> END', '= b1', '-> END'].join('\n')
    expect(run(src)).toEqual([])
  })
  it('外部跳进带参节点的子节点报 param-knot-stitch-entry', () => {
    const src = ['=== A ===', '-> 店.b1', '=== 店(cat) ===', '-> END', '= b1', '-> END'].join('\n')
    const ds = run(src)
    expect(ds.map((d) => d.code)).toContain('param-knot-stitch-entry')
  })
  it('子节点体内裸跳同级子节点有效', () => {
    const src = ['=== K ===', '= s1', '-> s2', '= s2', '-> END'].join('\n')
    expect(run(src)).toEqual([])
  })
  it('choice 内联跳转的实参个数也校验', () => {
    const src = ['=== A ===', '* [opt] -> 店("酒")', '=== 店(cat, disc) ===', '-> END'].join('\n')
    const ds = run(src)
    expect(ds.map((d) => d.code)).toContain('divert-arity')
  })
  it('带参节点内部 dotted 自引用子节点不报 param-knot-stitch-entry', () => {
    const src = ['=== 店(cat) ===', '-> 店.b1', '= b1', '-> END'].join('\n')
    const ds = run(src)
    expect(ds.map((d) => d.code)).not.toContain('param-knot-stitch-entry')
  })

  // A5：顶层开场（首个 === 前的 preamble）里的坏跳转旧实现完全跳过、零诊断。
  it('A5：开场（preamble）里的坏跳转目标报 unknown-divert-target', () => {
    const ds = run('开场白\n-> 不存在的节点\n=== A ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('unknown-divert-target')
  })
  it('A5：开场里选项结果跳转的坏目标也报', () => {
    const ds = run('开场白\n* [选] -> 没有这个\n=== A ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('unknown-divert-target')
  })
  it('A5：开场里跳到存在的节点不报', () => {
    expect(run('开场白\n-> A\n=== A ===\n-> END')).toEqual([])
  })

  // A10：子节点（stitch）不接受实参——实参被运行期静默吞掉、连副作用都不求值。
  it('A10：跳子节点带实参报 stitch-no-args', () => {
    const src = ['=== A ===', '-> B.s(1, 2)', '=== B ===', '= s', '-> END'].join('\n')
    expect(run(src).map((d) => d.code)).toContain('stitch-no-args')
  })
  it('A10：跳子节点无实参不报', () => {
    const src = ['=== A ===', '-> B.s', '=== B ===', '= s', '-> END'].join('\n')
    expect(run(src)).toEqual([])
  })
})
