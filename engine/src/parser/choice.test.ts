import { describe, it, expect } from 'vitest'
import { parseChoice } from './choice'
import { ParseError } from './errors'

const pc = (raw: string) => parseChoice(raw, 1, 'f')

describe('parseChoice —— 文本三种写法', () => {
  it('[显示] -> 目标：仅显示文本，结果为空', () => {
    expect(pc('[走向客栈] -> inn')).toEqual({
      condition: null,
      label: null,
      before: '',
      inner: '走向客栈',
      after: '',
      divert: '-> inn',
      fallback: false,
    })
  })

  it('无方括号：整段既是显示又是结果', () => {
    expect(pc('我累了。 -> 休息')).toEqual({
      condition: null,
      label: null,
      before: '我累了。',
      inner: null,
      after: '',
      divert: '-> 休息',
      fallback: false,
    })
  })

  it('[显示] 正文 -> 目标', () => {
    expect(pc('[我累了。] "辛苦你了。" -> 休息')).toEqual({
      condition: null,
      label: null,
      before: '',
      inner: '我累了。',
      after: '"辛苦你了。"',
      divert: '-> 休息',
      fallback: false,
    })
  })
})

describe('parseChoice —— 条件与标签', () => {
  it('条件 {cond}', () => {
    expect(pc('{gold >= 5} [买酒]')).toMatchObject({
      condition: 'gold >= 5',
      label: null,
      inner: '买酒',
      divert: null,
    })
  })

  it('标签 (label)', () => {
    expect(pc('(greet) [问候他]')).toMatchObject({ label: 'greet', inner: '问候他' })
  })

  it('cond 与 label 两种顺序等价', () => {
    expect(pc('{c} (l) [x]')).toMatchObject({ condition: 'c', label: 'l', inner: 'x' })
    expect(pc('(l) {c} [x]')).toMatchObject({ condition: 'c', label: 'l', inner: 'x' })
  })
})

describe('parseChoice —— fallback', () => {
  it('* -> 目标 是 fallback', () => {
    expect(pc('-> 没招了')).toEqual({
      condition: null,
      label: null,
      before: '',
      inner: null,
      after: '',
      divert: '-> 没招了',
      fallback: true,
    })
  })

  it('有文本就不是 fallback', () => {
    expect(pc('[再试] -> 没招了').fallback).toBe(false)
  })

  it('有条件就不是 fallback', () => {
    expect(pc('{x} -> 没招了').fallback).toBe(false)
  })
})

describe('parseChoice —— 错误', () => {
  it('[ 未闭合报错', () => {
    expect(() => pc('[显示 -> x')).toThrow(ParseError)
  })

  it('{cond} 未闭合报错', () => {
    expect(() => pc('{gold [x]')).toThrow(ParseError)
  })

  it('条件出现多次报错', () => {
    expect(() => pc('{a}{b}[x]')).toThrow(ParseError)
  })
})
