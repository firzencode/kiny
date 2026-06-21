import { describe, it, expect } from 'vitest'
import { transform } from './transform'
import { foldFile } from './block'
import { parseStructure } from './structure'
import { ParseError } from './errors'
import type { TextLine, ChoiceGroup, Conditional } from './ast'

/** 用 pass1+pass2 把无注释文本变成 RawFile 再 transform（便于喂测试输入）。 */
const tf = (src: string) => transform(foldFile(parseStructure(src, 'f.kin')))
const knotBody = (src: string) => tf(src).knots[0]!.body

describe('transform —— 文本与插值', () => {
  it('文本行拆成 TextLine，插值分配 id', () => {
    const body = knotBody('=== A ===\n你有{gold}金币')
    expect(body).toHaveLength(1)
    const t = body[0] as TextLine
    expect(t.kind).toBe('text')
    expect(t.glue).toBe(false)
    expect(t.segments).toEqual([
      { kind: 'literal', value: '你有' },
      { kind: 'interp', code: 'gold', id: 0 },
      { kind: 'literal', value: '金币' },
    ])
  })

  it('行末 -> 拆成 TextLine + 相邻 Divert', () => {
    const body = knotBody('=== A ===\n走吧 -> 家')
    expect(body).toHaveLength(2)
    expect(body[0]!.kind).toBe('text')
    expect(body[1]).toEqual({ kind: 'divert', target: '家', args: [], line: 2 })
  })

  it('行末内联 <> -> 拆成带 glue 的 TextLine + 相邻 Divert', () => {
    const body = knotBody('=== A ===\n我转身离开<> -> 走廊')
    expect(body).toHaveLength(2)
    const t = body[0] as TextLine
    expect(t.kind).toBe('text')
    expect(t.glue).toBe(true)
    expect(t.segments).toEqual([{ kind: 'literal', value: '我转身离开' }])
    expect(body[1]).toMatchObject({ kind: 'divert', target: '走廊' })
  })

  it('多处插值的 id 单调递增', () => {
    const body = knotBody('=== A ===\n{a}和{b}\n还有{c}')
    const ids: number[] = []
    for (const el of body) {
      if (el.kind === 'text') {
        for (const s of (el as TextLine).segments) {
          if (s.kind === 'interp') ids.push(s.id)
        }
      }
    }
    expect(ids).toEqual([0, 1, 2])
  })
})

describe('transform —— 叶子', () => {
  it('命令', () => {
    const body = knotBody('=== A ===\n@bg_show("x.jpg")')
    expect(body[0]).toEqual({ kind: 'command', name: 'bg_show', args: ['"x.jpg"'], line: 2 })
  })

  it('跳转', () => {
    const body = knotBody('=== A ===\n-> END')
    expect(body[0]).toEqual({ kind: 'divert', target: 'END', args: [], line: 2 })
  })

  it('多行逻辑块', () => {
    const body = knotBody('=== A ===\n~~~\nlet a = 1\n~~~')
    expect(body[0]).toEqual({ kind: 'logicBlock', code: 'let a = 1', line: 2, endLine: 4 })
  })
})

describe('transform —— 选项', () => {
  it('选项三段 + sticky + 条件 + resultDivert + body', () => {
    const src = ['=== A ===', '+ {gold>=5} [买酒] 喝一口 -> 客栈', '> ~ gold -= 5'].join('\n')
    const group = knotBody(src)[0] as ChoiceGroup
    expect(group.kind).toBe('choiceGroup')
    const c = group.choices[0]!
    expect(c.sticky).toBe(true)
    expect(c.fallback).toBe(false)
    expect(c.condition).toBe('gold>=5')
    expect(c.label).toBeNull()
    expect(c.inner).toEqual([{ kind: 'literal', value: '买酒' }])
    expect(c.after).toEqual([{ kind: 'literal', value: '喝一口' }])
    expect(c.resultDivert).toEqual({ kind: 'divert', target: '客栈', args: [], line: 2 })
    expect(c.body).toEqual([{ kind: 'logicLine', code: 'gold -= 5', line: 3 }])
  })

  it('一组多于一个 fallback 报错', () => {
    const src = ['=== A ===', '* -> 甲', '* -> 乙'].join('\n')
    expect(() => tf(src)).toThrow(ParseError)
  })
})

describe('transform —— @if 链', () => {
  it('提取分支条件，@else 为 null', () => {
    const src = ['=== A ===', '@if {x === 0}', '> 甲', '@else', '> 乙'].join('\n')
    const cond = knotBody(src)[0] as Conditional
    expect(cond.kind).toBe('conditional')
    expect(cond.branches.map((b) => b.condition)).toEqual(['x === 0', null])
  })

  it('@if 缺少条件 {} 报错', () => {
    const src = ['=== A ===', '@if', '> 甲'].join('\n')
    expect(() => tf(src)).toThrow(ParseError)
  })

  it('@elif 也提取条件', () => {
    const src = ['=== A ===', '@if {x === 0}', '> 甲', '@elif {x === 1}', '> 乙', '@else', '> 丙'].join('\n')
    const cond = knotBody(src)[0] as Conditional
    expect(cond.branches.map((b) => b.condition)).toEqual(['x === 0', 'x === 1', null])
  })

  it('空条件 @if {} 报错', () => {
    const src = ['=== A ===', '@if {}', '> 甲'].join('\n')
    expect(() => tf(src)).toThrow(ParseError)
  })

  it('条件后有多余内容报错', () => {
    const src = ['=== A ===', '@if {x} 多余', '> 甲'].join('\n')
    expect(() => tf(src)).toThrow(ParseError)
  })

  it('@else 带多余内容报错', () => {
    const src = ['=== A ===', '@if {x}', '> 甲', '@else 多余', '> 乙'].join('\n')
    expect(() => tf(src)).toThrow(ParseError)
  })
})
