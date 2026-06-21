import { describe, it, expect } from 'vitest'
import { parseKnotHeader, parseStitchHeader } from './declarations'
import { ParseError } from './errors'

describe('parseKnotHeader', () => {
  it('解析无参节点', () => {
    expect(parseKnotHeader('=== 雾港开场 ===', 1)).toEqual({ name: '雾港开场', params: [] })
  })

  it('允许省略等号两侧空格', () => {
    expect(parseKnotHeader('===雾港开场===', 1)).toEqual({ name: '雾港开场', params: [] })
  })

  it('解析带参节点', () => {
    expect(parseKnotHeader('=== 商店(category, discount) ===', 1)).toEqual({
      name: '商店',
      params: ['category', 'discount'],
    })
  })

  it('解析空参数列表', () => {
    expect(parseKnotHeader('=== 商店() ===', 1)).toEqual({ name: '商店', params: [] })
  })

  it('左右等号数不是 3 时报错', () => {
    expect(() => parseKnotHeader('== 名 ==', 1)).toThrow(ParseError)
    expect(() => parseKnotHeader('==== 名 ====', 1)).toThrow(ParseError)
    expect(() => parseKnotHeader('=== 名 ====', 1)).toThrow(ParseError)
  })

  it('缺少名字时报错', () => {
    expect(() => parseKnotHeader('===  ===', 1)).toThrow(ParseError)
  })

  it('名字含空格时报错', () => {
    expect(() => parseKnotHeader('=== 雾 港 ===', 1)).toThrow(ParseError)
  })

  it('参数缺右括号时报错', () => {
    expect(() => parseKnotHeader('=== 商店(category ===', 1)).toThrow(ParseError)
  })

  it('参数名不是 ASCII 标识符时报错', () => {
    expect(() => parseKnotHeader('=== 商店(类别) ===', 1)).toThrow(ParseError)
    expect(() => parseKnotHeader('=== 商店(1x) ===', 1)).toThrow(ParseError)
  })

  it('错误带上行号', () => {
    try {
      parseKnotHeader('== 名 ==', 7)
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(7)
    }
  })
})

describe('parseStitchHeader', () => {
  it('解析子节点名', () => {
    expect(parseStitchHeader('= 头等舱', 1)).toBe('头等舱')
  })

  it('允许省略等号后空格', () => {
    expect(parseStitchHeader('=头等舱', 1)).toBe('头等舱')
  })

  it('缺少名字时报错', () => {
    expect(() => parseStitchHeader('=', 1)).toThrow(ParseError)
    expect(() => parseStitchHeader('=   ', 1)).toThrow(ParseError)
  })

  it('名字含空格时报错', () => {
    expect(() => parseStitchHeader('= 头 等舱', 1)).toThrow(ParseError)
  })
})
