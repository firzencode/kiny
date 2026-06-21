import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { checkFallthrough } from './fallthrough'

const run = (src: string) => checkFallthrough([parse(src, 'f.kin')])

describe('checkFallthrough', () => {
  it('以 -> 结尾不报', () => {
    expect(run('=== A ===\n文本\n-> END')).toEqual([])
  })
  it('节点触底无显式出口报 warning', () => {
    const ds = run('=== A ===\n文本')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.severity).toBe('warning')
    expect(ds[0]!.code).toBe('fallthrough')
  })
  it('子节点触底无显式出口报 warning', () => {
    const ds = run('=== A ===\n-> s\n= s\n文本')
    expect(ds.map((d) => d.code)).toContain('fallthrough')
  })
  it('以选项组结尾不报', () => {
    expect(run('=== A ===\n文本\n* [x] -> END')).toEqual([])
  })
  it('以 @if 块结尾不报', () => {
    expect(run('=== A ===\n@if {x}\n> -> END\n@else\n> -> END')).toEqual([])
  })
})

describe('checkFallthrough —— 开场触底', () => {
  it('开场正文 + 后有显式节点、开场无跳转 → 警告', () => {
    const file = parse('引子。\n=== A ===\n正文\n-> END', 'main.kin')
    const ds = checkFallthrough([file])
    expect(ds.some((d) => d.code === 'fallthrough' && d.message.includes('开场'))).toBe(true)
  })
  it('开场以 -> 跳转收尾 → 不警告（针对开场）', () => {
    const file = parse('引子。\n-> A\n=== A ===\n正文\n-> END', 'main.kin')
    const ds = checkFallthrough([file])
    expect(ds.some((d) => d.message.includes('开场'))).toBe(false)
  })
  it('纯文本零-knot 文件触底 → 不警告', () => {
    const file = parse('就一段文本。\n第二行。', 'main.kin')
    const ds = checkFallthrough([file])
    expect(ds.some((d) => d.message.includes('开场'))).toBe(false)
  })
})
