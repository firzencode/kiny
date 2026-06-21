import { describe, it, expect } from 'vitest'
import { splitArgs, parseDivert, parseCommand } from './args'
import { ParseError } from './errors'

describe('splitArgs', () => {
  it('空实参返回空数组', () => {
    expect(splitArgs('', 1, 'f')).toEqual([])
    expect(splitArgs('   ', 1, 'f')).toEqual([])
  })

  it('单个与多个实参', () => {
    expect(splitArgs('"x"', 1, 'f')).toEqual(['"x"'])
    expect(splitArgs('"灯笼", 0.8', 1, 'f')).toEqual(['"灯笼"', '0.8'])
  })

  it('字符串内的逗号不切分', () => {
    expect(splitArgs('"a,b", c', 1, 'f')).toEqual(['"a,b"', 'c'])
  })

  it('嵌套括号内的逗号不切分', () => {
    expect(splitArgs('f(a, b), c', 1, 'f')).toEqual(['f(a, b)', 'c'])
    expect(splitArgs('[1, 2], 3', 1, 'f')).toEqual(['[1, 2]', '3'])
  })

  it('字符串内的右括号不影响配平', () => {
    expect(splitArgs('"a)b"', 1, 'f')).toEqual(['"a)b"'])
  })

  it('字符串未闭合报错', () => {
    expect(() => splitArgs('"x', 1, 'f')).toThrow(ParseError)
  })

  it('括号不配平报错', () => {
    expect(() => splitArgs('f(a', 1, 'f')).toThrow(ParseError)
  })
})

describe('parseDivert', () => {
  it('无参跳转', () => {
    expect(parseDivert('-> END', 1, 'f')).toEqual({ target: 'END', args: [] })
    expect(parseDivert('-> 客栈', 1, 'f')).toEqual({ target: '客栈', args: [] })
    expect(parseDivert('-> 父节点.子节点', 1, 'f')).toEqual({ target: '父节点.子节点', args: [] })
  })

  it('带参跳转', () => {
    expect(parseDivert('-> 商店("灯笼", 0.8)', 1, 'f')).toEqual({
      target: '商店',
      args: ['"灯笼"', '0.8'],
    })
  })

  it('实参字符串里的 // 不被破坏', () => {
    expect(parseDivert('-> 商店("http://x")', 1, 'f')).toEqual({
      target: '商店',
      args: ['"http://x"'],
    })
  })

  it('缺目标报错', () => {
    expect(() => parseDivert('->', 1, 'f')).toThrow(ParseError)
  })

  it('实参缺右括号报错', () => {
    expect(() => parseDivert('-> 商店("x"', 1, 'f')).toThrow(ParseError)
  })
})

describe('parseCommand', () => {
  it('解析命令名与实参', () => {
    expect(parseCommand('@bg_show("x.jpg")', 1, 'f')).toEqual({
      name: 'bg_show',
      args: ['"x.jpg"'],
    })
  })

  it('无参命令', () => {
    expect(parseCommand('@bg_hide()', 1, 'f')).toEqual({ name: 'bg_hide', args: [] })
  })

  it('实参字符串里的 // 不被破坏', () => {
    expect(parseCommand('@bgm_play("a//b.mp3")', 1, 'f')).toEqual({
      name: 'bgm_play',
      args: ['"a//b.mp3"'],
    })
  })

  it('非 @名字(...) 形式报错', () => {
    expect(() => parseCommand('@bad', 1, 'f')).toThrow(ParseError)
  })

  it('缺右括号报错', () => {
    expect(() => parseCommand('@x(a', 1, 'f')).toThrow(ParseError)
  })
})
