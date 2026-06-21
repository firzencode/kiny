import { describe, it, expect } from 'vitest'
import { foldBlock, foldFile } from './block'
import { splitLines } from './source'
import { parseStructure } from './structure'
import { ParseError } from './errors'
import type { RawChoiceGroup, RawConditional, RawChoice } from './rawblock'

const fold = (src: string) => foldBlock(splitLines(src), 'f.kin')

describe('foldBlock —— 叶子', () => {
  it('扁平文本行', () => {
    expect(fold('AAA\nBBB')).toEqual([
      { kind: 'text', raw: 'AAA', line: 1 },
      { kind: 'text', raw: 'BBB', line: 2 },
    ])
  })

  it('忽略空行', () => {
    expect(fold('AAA\n\nBBB')).toEqual([
      { kind: 'text', raw: 'AAA', line: 1 },
      { kind: 'text', raw: 'BBB', line: 3 },
    ])
  })

  it('逻辑行 / 跳转 / 命令 各自分类', () => {
    expect(fold('~ gold = 5')).toEqual([{ kind: 'logicLine', code: 'gold = 5', line: 1 }])
    expect(fold('-> END')).toEqual([{ kind: 'divert', raw: '-> END', line: 1 }])
    expect(fold('@bg_show("x")')).toEqual([{ kind: 'command', raw: '@bg_show("x")', line: 1 }])
  })

  it('level 0 的 ~~~ 块逐字拼接 code，带 endLine', () => {
    expect(fold('~~~\nlet a = 1\nlet b = 2\n~~~')).toEqual([
      { kind: 'logicBlock', code: 'let a = 1\nlet b = 2', line: 1, endLine: 4 },
    ])
  })
})

describe('foldBlock —— 选项', () => {
  it('相邻选项成一组，各带 > 体，组后是汇合兄弟元素', () => {
    const src = ['* [A]', '> 选了A', '* [B]', '> 选了B', '汇合'].join('\n')
    const block = fold(src)
    expect(block).toHaveLength(2)
    const group = block[0] as RawChoiceGroup
    expect(group.kind).toBe('choiceGroup')
    expect(group.choices).toHaveLength(2)
    expect(group.choices[0]).toEqual({
      sticky: false,
      raw: '[A]',
      body: [{ kind: 'text', raw: '选了A', line: 2 }],
      line: 1,
    })
    expect(group.choices[1]!.raw).toBe('[B]')
    expect(group.choices[1]!.line).toBe(3)
    expect(block[1]).toEqual({ kind: 'text', raw: '汇合', line: 5 })
  })

  it('+ 是粘性选项', () => {
    const group = fold('+ [再来] -> x')[0] as RawChoiceGroup
    expect(group.choices[0]!.sticky).toBe(true)
    expect(group.choices[0]!.raw).toBe('[再来] -> x')
  })

  it('嵌套选项：内层组在外层选项体内，内层汇合也在体内', () => {
    const src = [
      '* [米饭]',
      '> 点了米饭',
      '> * [青菜]',
      '> > 点了青菜',
      '> * [肉]',
      '> > 点了肉',
      '> 记下了',
      '* [面]',
      '> 点了面',
      '好嘞',
    ].join('\n')
    const block = fold(src)
    expect(block).toHaveLength(2)
    const outer = block[0] as RawChoiceGroup
    expect(outer.choices).toHaveLength(2)
    const rice = outer.choices[0]!
    expect(rice.raw).toBe('[米饭]')
    expect(rice.body).toHaveLength(3)
    expect(rice.body[0]).toEqual({ kind: 'text', raw: '点了米饭', line: 2 })
    const inner = rice.body[1] as RawChoiceGroup
    expect(inner.kind).toBe('choiceGroup')
    expect(inner.choices.map((c: RawChoice) => c.raw)).toEqual(['[青菜]', '[肉]'])
    expect(inner.choices[0]!.body).toEqual([{ kind: 'text', raw: '点了青菜', line: 4 }])
    expect(rice.body[2]).toEqual({ kind: 'text', raw: '记下了', line: 7 })
    expect(outer.choices[1]!.raw).toBe('[面]')
    expect(block[1]).toEqual({ kind: 'text', raw: '好嘞', line: 10 })
  })
})

describe('foldBlock —— @if 链', () => {
  it('@if/@elif/@else 串成一条 conditional，链后是汇合', () => {
    const src = ['@if {x}', '> A', '@elif {y}', '> B', '@else', '> C', '后续'].join('\n')
    const block = fold(src)
    expect(block).toHaveLength(2)
    const cond = block[0] as RawConditional
    expect(cond.kind).toBe('conditional')
    expect(cond.branches.map((b) => b.selector)).toEqual(['if', 'elif', 'else'])
    expect(cond.branches[0]).toEqual({
      selector: 'if',
      raw: '{x}',
      body: [{ kind: 'text', raw: 'A', line: 2 }],
      line: 1,
    })
    expect(cond.branches[2]!.raw).toBe('')
    expect(block[1]).toEqual({ kind: 'text', raw: '后续', line: 7 })
  })
})

describe('foldBlock —— 错误', () => {
  it('> 层级跳跃报错', () => {
    expect(() => fold('> 孤儿分支')).toThrow(ParseError)
  })

  it('@elif 前无 @if 报错', () => {
    expect(() => fold('@elif {x}\n> B')).toThrow(ParseError)
  })

  it('@else 之后再出现分支报错', () => {
    const src = ['@if {x}', '> A', '@else', '> B', '@elif {y}', '> C'].join('\n')
    expect(() => fold(src)).toThrow(ParseError)
  })

  it('~~~ 出现在分支体内（level>0）报错', () => {
    const src = ['* [A]', '> ~~~', '> let a = 1', '> ~~~'].join('\n')
    expect(() => fold(src)).toThrow(ParseError)
  })

  it('~~~ 未闭合报错', () => {
    expect(() => fold('~~~\nlet a = 1')).toThrow(ParseError)
  })
})

describe('foldFile', () => {
  it('把骨架每个 body 折叠成 RawBlock', () => {
    const skeleton = parseStructure('=== A ===\n* [去] -> B\n=== B ===\n结束\n-> END', 'f.kin')
    const file = foldFile(skeleton)
    expect(file.path).toBe('f.kin')
    expect(file.knots.map((k) => k.name)).toEqual(['A', 'B'])
    expect(file.knots[0]!.body[0]!.kind).toBe('choiceGroup')
    expect(file.knots[1]!.body).toEqual([
      { kind: 'text', raw: '结束', line: 4 },
      { kind: 'divert', raw: '-> END', line: 5 },
    ])
  })
})
