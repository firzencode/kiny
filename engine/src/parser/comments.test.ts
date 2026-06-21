import { describe, it, expect } from 'vitest'
import { stripComments } from './comments'
import { ParseError } from './errors'

const strip = (t: string) => stripComments(t, 'main.kin')

describe('stripComments —— 剥离', () => {
  it('叙事行的 // 删到行尾，长度不变', () => {
    const r = strip('你好 // 注释')
    expect(r.length).toBe('你好 // 注释'.length)
    expect(r.trimEnd()).toBe('你好')
  })

  it('单行 /* */ 替为空格，长度不变', () => {
    const r = strip('a /* x */ b')
    expect(r.length).toBe('a /* x */ b'.length)
    expect(r.replace(/ +/g, ' ')).toBe('a b')
  })

  it('声明行尾的 // 被剥', () => {
    const r = strip('=== 开场 === // 注释')
    expect(r.trimEnd()).toBe('=== 开场 ===')
  })

  it('行数与行号保真', () => {
    const src = 'a\n// 整行注释\nb\nc'
    const out = strip(src)
    expect(out.split('\n').length).toBe(4)
    expect(out.split('\n')[2]).toBe('b')
  })
})

describe('stripComments —— 转义与字面', () => {
  it('\\/ 不算注释起始，原样保留', () => {
    expect(strip('a \\/ b')).toBe('a \\/ b')
    expect(strip('http:\\/\\/x')).toBe('http:\\/\\/x')
  })

  it('转义反斜杠后再出现的 // 仍是注释', () => {
    // \\ 是字面反斜杠，其后 // 起注释
    const r = strip('a \\\\// 注释')
    expect(r.trimEnd()).toBe('a \\\\')
  })
})

describe('stripComments —— JS 区域豁免', () => {
  it('{} 插值内的 // 保留', () => {
    expect(strip('值 { a // b } 末')).toBe('值 { a // b } 末')
  })

  it('{} 插值配平识别字符串里的 }', () => {
    expect(strip('{ "a}b" } 末')).toBe('{ "a}b" } 末')
  })

  it('~ 行整行豁免（其 // 是 JS 注释）', () => {
    expect(strip('~ x = 1 // note')).toBe('~ x = 1 // note')
  })

  it('~~~ 块内整段豁免', () => {
    const src = '~~~\nlet a = 1 // c\nlet b = 2 /* c */\n~~~'
    expect(strip(src)).toBe(src)
  })

  it('命令行整行豁免，参数里的 // 保留', () => {
    expect(strip('@bg_show("http://x.jpg")')).toBe('@bg_show("http://x.jpg")')
    expect(strip('@bgm_play("a//b.mp3")')).toBe('@bgm_play("a//b.mp3")')
  })

  it('@if 行被扫描（非命令豁免），尾随 // 被剥、{cond} 保留', () => {
    const r = strip('@if {x > 0} // 注释')
    expect(r.trimEnd()).toBe('@if {x > 0}')
  })

  it('行末内联 -> 之后整体豁免，实参字符串里的 // 不被剥', () => {
    const src = '走吧。-> 商店("http://x")'
    expect(strip(src)).toBe(src)
  })

  it('-> 之前的 // 会把整行剩余（含跳转）注释掉', () => {
    const r = strip('a // b -> c')
    expect(r.trimEnd()).toBe('a')
  })
})

describe('stripComments —— 块注释跨行', () => {
  it('跨行 /* */ 可吃掉中间的 === 行，行数不变', () => {
    const src = ['=== A ===', '/* 注释开始', '=== B ===', '注释结束 */', '尾巴'].join('\n')
    const out = strip(src).split('\n')
    expect(out.length).toBe(5)
    expect(out[0]).toBe('=== A ===')
    expect(out[2]!.trim()).toBe('') // === B === 被吃掉
    expect(out[4]).toBe('尾巴')
  })

  it('块注释闭合后同一行剩余内容继续按文本处理', () => {
    const r = strip('/* x */ 你好')
    expect(r.length).toBe('/* x */ 你好'.length)
    expect(r.trimEnd().trimStart()).toBe('你好')
  })

  it('未闭合的块注释抛 ParseError，行号为 /* 起始行', () => {
    try {
      strip('a\n/* oops\nb')
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(2)
      expect((e as ParseError).path).toBe('main.kin')
    }
  })
})

describe('stripComments —— 分支体内 >-前缀控制行豁免', () => {
  it('> ~ 逻辑行整行豁免，字符串里的 // 保留', () => {
    expect(strip('> ~ url = "http://x"')).toBe('> ~ url = "http://x"')
  })

  it('> @命令 行整行豁免，参数里的 // 保留', () => {
    expect(strip('> @bg_show("a//b.jpg")')).toBe('> @bg_show("a//b.jpg")')
  })

  it('> -> 跳转行豁免（行内 -> 规则兜住）', () => {
    expect(strip('> -> 商店("http://y")')).toBe('> -> 商店("http://y")')
  })

  it('> 文本行仍被扫描剥注释', () => {
    expect(strip('> 文本 // 注释').trimEnd()).toBe('> 文本')
  })

  it('> @if 行被扫描，{cond} 保留、尾随 // 被剥', () => {
    expect(strip('> @if {x > 0} // 注释').trimEnd()).toBe('> @if {x > 0}')
  })
})
