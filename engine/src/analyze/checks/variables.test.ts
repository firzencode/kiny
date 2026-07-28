import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { buildSymbolTable } from '../symbols'
import { checkVariables } from './variables'

const run = (...srcs: string[]) =>
  checkVariables(buildSymbolTable(srcs.map((s, i) => parse(s, `f${i}.kin`))))

describe('checkVariables', () => {
  it('正例：已声明变量、内置、标签、JS 全局零诊断', () => {
    const src = ['~ let gold = 10', '=== A ===', '* (greet) [嗨]', '你有{gold + Math.max(0,1)}金币 {greet}', '-> END'].join('\n')
    expect(run(src)).toEqual([])
  })
  it('未声明变量报 undeclared-var', () => {
    const ds = run('=== A ===\n你有{glod}金币\n-> END')
    expect(ds.map((d) => d.code)).toContain('undeclared-var')
  })
  it('节点局部变量在别的节点不可见', () => {
    const src = ['=== A ===', '~ let dice = 1', '-> END', '=== B ===', '{dice}', '-> END'].join('\n')
    expect(run(src).map((d) => d.code)).toContain('undeclared-var')
  })
  it('参数在本节点可见', () => {
    expect(run('=== 店(cat) ===\n{cat}\n-> END')).toEqual([])
  })
  it('跨文件全局重复声明报 duplicate-global', () => {
    const ds = run('~ let gold = 1\n=== A ===\n-> END', '~ let gold = 2\n=== B ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('duplicate-global')
  })
  it('JS 片段写错报 js-syntax-error', () => {
    const ds = run('=== A ===\n你有{gold +}金币\n-> END')
    expect(ds.map((d) => d.code)).toContain('js-syntax-error')
  })
  it('JS 语法错误片段不额外报 undeclared-var', () => {
    const ds = run('=== A ===\n你有{gold +}金币\n-> END')
    expect(ds.every((d) => d.code !== 'undeclared-var')).toBe(true)
  })
  it('全局+局部同名不触发 duplicate-global', () => {
    const ds = run('~ let gold = 1\n=== A ===\n~ let gold = 0\n-> END')
    expect(ds.map((d) => d.code)).not.toContain('duplicate-global')
  })

  // A7：给内置函数赋值破坏该 Story 的内置函数（B 是实例级共享层）。
  it('给内置函数赋值报 assign-builtin', () => {
    expect(run('~ random = 5\n=== A ===\n-> END').map((d) => d.code)).toContain('assign-builtin')
  })
  it('自增内置函数也报 assign-builtin', () => {
    expect(run('~ random++\n=== A ===\n-> END').map((d) => d.code)).toContain('assign-builtin')
  })
  it('给普通变量赋值不报 assign-builtin', () => {
    const ds = run('~ let g = 0\n=== A ===\n~ g = 5\n-> END')
    expect(ds.map((d) => d.code)).not.toContain('assign-builtin')
  })

  // $nodes 保留名：可引用，但声明 / 赋值均报 error。
  it('引用 $nodes 不报 undeclared-var', () => {
    expect(run('=== A ===\n{Object.keys($nodes).length}\n-> END')).toEqual([])
  })
  it('给 $nodes 赋值报 reserved-name', () => {
    expect(run('~ $nodes = 5\n=== A ===\n-> END').map((d) => d.code)).toContain('reserved-name')
  })
  it('顶层声明 $nodes 报 reserved-name', () => {
    expect(run('~ let $nodes = 1\n=== A ===\n-> END').map((d) => d.code)).toContain('reserved-name')
  })
})
