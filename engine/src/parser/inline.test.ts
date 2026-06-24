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
      issues: [],
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
      issues: [],
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
      issues: [],
    })
  })

  it('插值 code 是 {} 之间的原始 JS（字符串内 } 不闭合）', () => {
    expect(scan('{ "a}b" }')).toEqual({
      segments: [{ kind: 'interp', code: ' "a}b" ', id: 0 }],
      glue: false,
      nextId: 1,
      issues: [],
    })
  })

  it('空字符串无 segment', () => {
    expect(scan('')).toEqual({ segments: [], glue: false, nextId: 0, issues: [] })
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
      issues: [],
    })
  })

  it('转义的 \\<> 不是粘连', () => {
    expect(scan('a\\<>')).toEqual({
      segments: [{ kind: 'literal', value: 'a<>' }],
      glue: false,
      nextId: 0,
      issues: [],
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
      issues: [],
    })
  })
})

describe('scanInline —— 富文本标签', () => {
  it('单个 <b> 标签把内部文本标粗，标签外不带样式', () => {
    expect(scan('普通<b>粗体</b>尾').segments).toEqual([
      { kind: 'literal', value: '普通' },
      { kind: 'literal', value: '粗体', style: { bold: true } },
      { kind: 'literal', value: '尾' },
    ])
  })

  it('i / u / s 各映射对应样式键', () => {
    expect(scan('<i>斜</i><u>下</u><s>删</s>').segments).toEqual([
      { kind: 'literal', value: '斜', style: { italic: true } },
      { kind: 'literal', value: '下', style: { underline: true } },
      { kind: 'literal', value: '删', style: { strike: true } },
    ])
  })

  it('嵌套标签扁平化叠加样式', () => {
    expect(scan('<b>粗<color=red>粗红</color></b>').segments).toEqual([
      { kind: 'literal', value: '粗', style: { bold: true } },
      { kind: 'literal', value: '粗红', style: { bold: true, color: 'red' } },
    ])
  })

  it('<color> 支持 #rgb / #rrggbb / 具名色', () => {
    expect(scan('<color=#f00>a</color><color=#ff0000>b</color><color=blue>c</color>').segments).toEqual([
      { kind: 'literal', value: 'a', style: { color: '#f00' } },
      { kind: 'literal', value: 'b', style: { color: '#ff0000' } },
      { kind: 'literal', value: 'c', style: { color: 'blue' } },
    ])
  })

  it('<size> 落正数倍数；内层覆盖外层', () => {
    expect(scan('<size=1.5>大<size=0.8>小</size></size>').segments).toEqual([
      { kind: 'literal', value: '大', style: { size: 1.5 } },
      { kind: 'literal', value: '小', style: { size: 0.8 } },
    ])
  })

  it('<br> 产出换行段（自闭合，无文本）', () => {
    expect(scan('上<br>下').segments).toEqual([
      { kind: 'literal', value: '上' },
      { kind: 'break' },
      { kind: 'literal', value: '下' },
    ])
  })

  it('插值段承继当前标签样式', () => {
    expect(scan('<b>{x}</b>').segments).toEqual([
      { kind: 'interp', code: 'x', id: 0, style: { bold: true } },
    ])
  })

  it('未闭合标签：自动闭合到段末（样式照应用）+ 记 rich-unclosed 诊断', () => {
    const r = scan('<b>粗到底')
    expect(r.segments).toEqual([{ kind: 'literal', value: '粗到底', style: { bold: true } }])
    expect(r.issues).toEqual([{ code: 'rich-unclosed', message: '未闭合的标签：「<b>」', line: 1 }])
  })

  it('错配闭标签：弹到最近同名开标签；孤立闭标签记 rich-mismatch', () => {
    const r = scan('a</i>b')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'ab' }])
    expect(r.issues).toEqual([{ code: 'rich-mismatch', message: '孤立的闭标签：「</i>」', line: 1 }])
  })

  it('非法颜色值：不应用颜色 + 记 rich-bad-color（标签结构仍成对）', () => {
    const r = scan('<color=rgb(1,2,3)>x</color>')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x' }])
    expect(r.issues).toEqual([{ code: 'rich-bad-color', message: '非法颜色值：「rgb(1,2,3)」', line: 1 }])
  })

  it('非法字号值：不应用字号 + 记 rich-bad-size', () => {
    const r = scan('<size=-1>x</size>')
    expect(r.segments).toEqual([{ kind: 'literal', value: 'x' }])
    expect(r.issues).toEqual([{ code: 'rich-bad-size', message: '非法字号倍数：「-1」', line: 1 }])
  })

  it('未知标签名按字面处理裸 <（兼容历史文本）', () => {
    expect(scan('a<foo>b').segments).toEqual([{ kind: 'literal', value: 'a<foo>b' }])
    expect(scan('1 < 2 > 0').segments).toEqual([{ kind: 'literal', value: '1 < 2 > 0' }])
  })

  it('\\< 转义后不识别为标签', () => {
    expect(scan('\\<b>x').segments).toEqual([{ kind: 'literal', value: '<b>x' }])
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
