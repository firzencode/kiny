import { describe, it, expect } from 'vitest'
import { scanInline, splitInlineDivert } from './inline'
import { ParseError } from './errors'

const scan = (t: string, startId = 0) => scanInline(t, startId, 1, 'f.kin')

describe('scanInline —— 字面与插值', () => {
  it('纯字面文本', () => {
    expect(scan('你好世界')).toEqual({
      segments: [{ kind: 'literal', value: '你好世界' }],
      glue: false,
      nextId: 0,
    })
  })

  it('单个插值分配 id 0', () => {
    expect(scan('你有{gold}金币')).toEqual({
      segments: [
        { kind: 'literal', value: '你有' },
        { kind: 'interp', code: 'gold', id: 0 },
        { kind: 'literal', value: '金币' },
      ],
      glue: false,
      nextId: 1,
    })
  })

  it('多个插值依次分配 id，从 startId 起', () => {
    expect(scan('{a}{b}', 5)).toEqual({
      segments: [
        { kind: 'interp', code: 'a', id: 5 },
        { kind: 'interp', code: 'b', id: 6 },
      ],
      glue: false,
      nextId: 7,
    })
  })

  it('插值 code 是 {} 之间的原始 JS（字符串内 } 不闭合）', () => {
    expect(scan('{ "a}b" }')).toEqual({
      segments: [{ kind: 'interp', code: ' "a}b" ', id: 0 }],
      glue: false,
      nextId: 1,
    })
  })

  it('空字符串无 segment', () => {
    expect(scan('')).toEqual({ segments: [], glue: false, nextId: 0 })
  })
})

describe('scanInline —— 转义还原', () => {
  it('\\{ \\} \\< \\/ \\\\ 任意位置还原为字面', () => {
    expect(scan('a\\{b\\}c\\<d\\/e\\\\f').segments).toEqual([
      { kind: 'literal', value: 'a{b}c<d/e\\f' },
    ])
  })

  it('\\-> 还原为字面 ->', () => {
    expect(scan('走\\->吧').segments).toEqual([{ kind: 'literal', value: '走->吧' }])
  })

  it('未定义的转义保留反斜杠', () => {
    expect(scan('a\\b').segments).toEqual([{ kind: 'literal', value: 'a\\b' }])
  })
})

describe('scanInline —— 粘连 <>', () => {
  it('行末 <> 置 glue，不进 segments', () => {
    expect(scan('离开<>')).toEqual({
      segments: [{ kind: 'literal', value: '离开' }],
      glue: true,
      nextId: 0,
    })
  })

  it('转义的 \\<> 不是粘连', () => {
    expect(scan('a\\<>')).toEqual({
      segments: [{ kind: 'literal', value: 'a<>' }],
      glue: false,
      nextId: 0,
    })
  })

  it('非行末的 <> 不是粘连，按字面处理', () => {
    expect(scan('a<>b').segments).toEqual([{ kind: 'literal', value: 'a<>b' }])
    expect(scan('a<>b').glue).toBe(false)
  })

  it('行末 <> 之后仅余空白也算 glue', () => {
    expect(scan('离开<> ')).toEqual({
      segments: [{ kind: 'literal', value: '离开' }],
      glue: true,
      nextId: 0,
    })
  })
})

describe('scanInline —— 错误', () => {
  it('未闭合的 { 抛 ParseError，带行号与路径', () => {
    try {
      scanInline('你有{gold 金币', 0, 7, 'main.kin')
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(7)
      expect((e as ParseError).path).toBe('main.kin')
    }
  })
})

describe('splitInlineDivert', () => {
  it('无 -> 时 divert 为 null', () => {
    expect(splitInlineDivert('走吧')).toEqual({ text: '走吧', divert: null })
  })

  it('切出行末 -> 跳转', () => {
    expect(splitInlineDivert('走吧 -> 家')).toEqual({ text: '走吧 ', divert: '-> 家' })
  })

  it('转义的 \\-> 不算跳转', () => {
    expect(splitInlineDivert('走吧\\->家')).toEqual({ text: '走吧\\->家', divert: null })
  })

  it('插值内的 -> 不算跳转', () => {
    expect(splitInlineDivert('{a->b}尾')).toEqual({ text: '{a->b}尾', divert: null })
  })

  it('<> 留在左半文本里', () => {
    expect(splitInlineDivert('离开<> -> 家')).toEqual({ text: '离开<> ', divert: '-> 家' })
  })

  it('整行就是跳转时左半为空', () => {
    expect(splitInlineDivert('-> 家')).toEqual({ text: '', divert: '-> 家' })
  })
})
