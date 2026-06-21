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
})
