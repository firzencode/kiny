import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { collectFragments } from './fragments'

const frags = (src: string) => collectFragments(parse(src, 'f.kin'))

describe('collectFragments', () => {
  it('preamble 的 ~ 行是 global / stmt', () => {
    const fs = frags('~ let gold = 10\n=== A ===\n-> END')
    const g = fs.find((f) => f.code.includes('gold'))!
    expect(g.scope).toEqual({ kind: 'global' })
    expect(g.mode).toBe('stmt')
  })
  it('节点内插值是 knot / expr', () => {
    const fs = frags('=== A ===\n你有{gold}金币\n-> END')
    const f = fs.find((x) => x.code === 'gold')!
    expect(f.scope).toEqual({ kind: 'knot', name: 'A' })
    expect(f.mode).toBe('expr')
  })
  it('@if 条件、选项条件、divert/command 实参都被收', () => {
    const src = [
      '=== A ===',
      '@bg_show(currentBg)',
      '@if {met === 0}',
      '> 第一次。',
      '* {gold >= 5} [买] -> 店("酒", n)',
      '= 子',
      '-> END',
    ].join('\n')
    const codes = frags(src).map((f) => f.code)
    expect(codes).toContain('currentBg')   // command 实参
    expect(codes).toContain('met === 0')   // @if 条件
    expect(codes).toContain('gold >= 5')   // 选项条件
    expect(codes).toContain('"酒"')         // divert 实参 1
    expect(codes).toContain('n')           // divert 实参 2
  })
  it('选项体内的片段仍归宿主 knot', () => {
    const src = ['=== A ===', '* [选] ', '> ~ gold -= 5', '> -> END'].join('\n')
    const f = frags(src).find((x) => x.code.includes('gold -='))!
    expect(f.scope).toEqual({ kind: 'knot', name: 'A' })
    expect(f.mode).toBe('stmt')
  })
  it('~~~ 逻辑块是 stmt', () => {
    const fs = frags('=== A ===\n~~~\nlet t = 0\n~~~\n-> END')
    const f = fs.find((x) => x.code.includes('let t'))!
    expect(f.mode).toBe('stmt')
    expect(f.scope).toEqual({ kind: 'knot', name: 'A' })
  })
  it('子节点体内的片段归宿主 knot', () => {
    const fs = frags('=== A ===\n-> sub\n= sub\n你有{gold}金币\n-> END')
    const f = fs.find((x) => x.code === 'gold')!
    expect(f.scope).toEqual({ kind: 'knot', name: 'A' })
  })
})
