import { describe, it, expect } from 'vitest'
import { parseStructure } from './structure'
import { ParseError } from './errors'

describe('parseStructure', () => {
  it('解析单个节点及其正文', () => {
    const file = parseStructure('=== 开场 ===\n雾涌上来。\n你站在码头。', 'main.kin')
    expect(file.path).toBe('main.kin')
    expect(file.preamble).toEqual([])
    expect(file.knots).toHaveLength(1)
    const knot = file.knots[0]!
    expect(knot.name).toBe('开场')
    expect(knot.params).toEqual([])
    expect(knot.line).toBe(1)
    expect(knot.stitches).toEqual([])
    expect(knot.body).toEqual([
      { line: 2, text: '雾涌上来。' },
      { line: 3, text: '你站在码头。' },
    ])
  })

  it('把第一个节点之前的行放进 preamble', () => {
    const file = parseStructure('~ let gold = 10\n\n=== 开场 ===\nAAA', 'main.kin')
    expect(file.preamble).toEqual([
      { line: 1, text: '~ let gold = 10' },
      { line: 2, text: '' },
    ])
    expect(file.knots).toHaveLength(1)
    expect(file.knots[0]!.body).toEqual([{ line: 4, text: 'AAA' }])
  })

  it('解析节点正文与多个子节点', () => {
    const src = [
      '=== 火车上 ===',
      '雾从车窗外掠过。',
      '= 头等舱',
      '奢华。',
      '= 三等舱',
      '拥挤。',
    ].join('\n')
    const file = parseStructure(src, 'main.kin')
    const knot = file.knots[0]!
    expect(knot.name).toBe('火车上')
    expect(knot.body).toEqual([{ line: 2, text: '雾从车窗外掠过。' }])
    expect(knot.stitches).toHaveLength(2)
    expect(knot.stitches[0]).toMatchObject({ name: '头等舱', line: 3 })
    expect(knot.stitches[0]!.body).toEqual([{ line: 4, text: '奢华。' }])
    expect(knot.stitches[1]).toMatchObject({ name: '三等舱', line: 5 })
    expect(knot.stitches[1]!.body).toEqual([{ line: 6, text: '拥挤。' }])
  })

  it('解析多个节点', () => {
    const file = parseStructure('=== 甲 ===\nA\n=== 乙 ===\nB', 'main.kin')
    expect(file.knots.map((k) => k.name)).toEqual(['甲', '乙'])
    expect(file.knots[1]!.line).toBe(3)
  })

  it('前导 \\= 的行是正文不是子节点', () => {
    const file = parseStructure('=== 甲 ===\n\\= 这是字面等号', 'main.kin')
    expect(file.knots[0]!.stitches).toEqual([])
    expect(file.knots[0]!.body).toEqual([{ line: 2, text: '\\= 这是字面等号' }])
  })

  it('子节点出现在任何节点之前时报错', () => {
    expect(() => parseStructure('= 孤儿子节点\nAAA', 'main.kin')).toThrow(ParseError)
  })

  it('节点声明格式错误时把行号与路径透传给 ParseError', () => {
    try {
      parseStructure('=== 甲 ===\n== 坏头 ==', 'main.kin')
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(2)
      expect((e as ParseError).path).toBe('main.kin')
    }
  })
})
