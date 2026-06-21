import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { openingKnotName, resolveStart } from './opening'

describe('开场 knot 保留名撞名安全', () => {
  it('保留名含空白，validateNodeName 拒绝同名 knot', () => {
    expect(/\s/.test(openingKnotName('main.kin'))).toBe(true)
  })
  it('作者写形似保留名的 knot，解析名与保留名不相等（不撞名）', () => {
    const file = parse('=== opening:main.kin ===\n正文\n-> END', 'main.kin')
    const { program } = analyze([file])
    expect(program!.knots.has('opening:main.kin')).toBe(true)
    expect(program!.knots.has(openingKnotName('main.kin'))).toBe(false)
  })
})

describe('analyze 开场 knot 合成', () => {
  it('有 preamble 的文件：program.knots 多出一个开场 knot（scope global，body=preamble），file.knots 不变', () => {
    const file = parse('~ let gold = 10\n开场白。\n=== A ===\n正文\n-> END', 'main.kin')
    const { program } = analyze([file])
    expect(program).not.toBeNull()
    expect(program!.files[0]!.knots.map((k) => k.name)).toEqual(['A'])
    const opening = openingKnotName('main.kin')
    expect(program!.knots.has('A')).toBe(true)
    expect(program!.knots.has(opening)).toBe(true)
    const ok = program!.knots.get(opening)!
    expect(ok.scope).toBe('global')
    expect(ok.body).toEqual(program!.files[0]!.preamble)
  })
  it('无 preamble 的文件：不合成开场 knot', () => {
    const file = parse('=== A ===\n正文\n-> END', 'main.kin')
    const { program } = analyze([file])
    expect(program!.knots.has(openingKnotName('main.kin'))).toBe(false)
  })
  it('纯文本零-knot 文件：合成开场 knot，file.knots 为空', () => {
    const file = parse('从头到尾一段文本。\n第二行。', 'main.kin')
    const { program } = analyze([file])
    expect(program).not.toBeNull()
    expect(program!.files[0]!.knots).toEqual([])
    expect(program!.knots.has(openingKnotName('main.kin'))).toBe(true)
  })
})

describe('resolveStart 入口解析', () => {
  it('入口文件有 preamble → 开场 knot 名', () => {
    const { program } = analyze([parse('引子。\n=== A ===\n正文\n-> END', 'main.kin')])
    expect(resolveStart(program!, 'main.kin')).toBe(openingKnotName('main.kin'))
  })
  it('入口文件无 preamble → 第一个显式 knot 名', () => {
    const { program } = analyze([parse('=== A ===\n正文\n-> END', 'main.kin')])
    expect(resolveStart(program!, 'main.kin')).toBe('A')
  })
  it('纯文本零-knot → 开场 knot 名', () => {
    const { program } = analyze([parse('就一段文本。', 'main.kin')])
    expect(resolveStart(program!, 'main.kin')).toBe(openingKnotName('main.kin'))
  })
  it('入口路径不存在 → null', () => {
    const { program } = analyze([parse('=== A ===\n-> END', 'main.kin')])
    expect(resolveStart(program!, 'nope.kin')).toBeNull()
  })
})
