import { describe, it, expect } from 'vitest'
import { makeTextSpan, coalesce, mergeSpans, plainText } from './spans'

describe('makeTextSpan', () => {
  it('无样式时只剩 text', () => {
    expect(makeTextSpan('a')).toEqual({ text: 'a' })
  })
  it('仅落生效的样式键', () => {
    expect(makeTextSpan('a', { bold: true, italic: false, color: 'red', size: 1.5 })).toEqual({
      text: 'a',
      bold: true,
      color: 'red',
      size: 1.5,
    })
  })
})

describe('coalesce', () => {
  it('相邻同样式文本合并；break 是边界', () => {
    expect(
      coalesce([{ text: '甲' }, { text: '乙' }, { kind: 'break' }, { text: '丙', bold: true }]),
    ).toEqual([{ text: '甲乙' }, { kind: 'break' }, { text: '丙', bold: true }])
  })
  it('不同样式不合并', () => {
    expect(coalesce([{ text: 'a', bold: true }, { text: 'b' }])).toEqual([
      { text: 'a', bold: true },
      { text: 'b' },
    ])
  })
})

describe('mergeSpans', () => {
  it('拼接两段并归并边界', () => {
    expect(mergeSpans([{ text: '甲' }], [{ text: '乙' }])).toEqual([{ text: '甲乙' }])
  })
})

describe('plainText', () => {
  it('break → 换行，文本顺序拼接', () => {
    expect(plainText([{ text: '上' }, { kind: 'break' }, { text: '下', bold: true }])).toBe('上\n下')
  })
})
