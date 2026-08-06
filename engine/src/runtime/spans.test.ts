import { describe, it, expect } from 'vitest'
import { makeTextSpan, coalesce, mergeSpans, plainText, sameSpans } from './spans'

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
  it('pauseBefore 是硬边界：同样式也不合并（否则停顿位置丢失）', () => {
    expect(coalesce([{ text: '甲' }, { text: '乙', pauseBefore: true }])).toEqual([
      { text: '甲' },
      { text: '乙', pauseBefore: true },
    ])
  })
  it('毫秒档同样是硬边界（两档同等对待，看字段是否存在）', () => {
    expect(coalesce([{ text: '甲' }, { text: '乙', pauseBefore: 500 }])).toEqual([
      { text: '甲' },
      { text: '乙', pauseBefore: 500 },
    ])
  })
  it('两档相邻段不被误合（档位不同即不同段）', () => {
    expect(coalesce([{ text: '甲', pauseBefore: true }, { text: '乙', pauseBefore: 500 }])).toEqual([
      { text: '甲', pauseBefore: true },
      { text: '乙', pauseBefore: 500 },
    ])
  })
})

describe('mergeSpans', () => {
  it('拼接两段并归并边界', () => {
    expect(mergeSpans([{ text: '甲' }], [{ text: '乙' }])).toEqual([{ text: '甲乙' }])
  })
  it('glue 拼行：后半行行首的停顿标记在拼接处保留', () => {
    expect(mergeSpans([{ text: '前半' }], [{ text: '后半', pauseBefore: true }])).toEqual([
      { text: '前半' },
      { text: '后半', pauseBefore: true },
    ])
  })
  it('glue 拼行：毫秒档档位在拼接处原样保留', () => {
    expect(mergeSpans([{ text: '前半' }], [{ text: '后半', pauseBefore: 1500 }])).toEqual([
      { text: '前半' },
      { text: '后半', pauseBefore: 1500 },
    ])
  })
})

describe('makeTextSpan —— pauseBefore', () => {
  it('传入停顿标记时落 pauseBefore；否则不落该键', () => {
    expect(makeTextSpan('a', undefined, true)).toEqual({ text: 'a', pauseBefore: true })
    expect(makeTextSpan('a', undefined, undefined)).toEqual({ text: 'a' })
  })
  it('毫秒档原样落到字段上（不被压成 true）', () => {
    expect(makeTextSpan('a', undefined, 750)).toEqual({ text: 'a', pauseBefore: 750 })
  })
})

describe('sameSpans —— 停顿按值比', () => {
  it('两档不判等（否则拼行 / 快照比对会把档位丢掉）', () => {
    expect(sameSpans([{ text: 'a', pauseBefore: true }], [{ text: 'a', pauseBefore: 500 }])).toBe(false)
  })
  it('毫秒数不同不判等', () => {
    expect(sameSpans([{ text: 'a', pauseBefore: 500 }], [{ text: 'a', pauseBefore: 800 }])).toBe(false)
  })
  it('同档同值判等', () => {
    expect(sameSpans([{ text: 'a', pauseBefore: 500 }], [{ text: 'a', pauseBefore: 500 }])).toBe(true)
  })
  it('break 的档位同样按值比', () => {
    expect(sameSpans([{ kind: 'break', pauseBefore: 500 }], [{ kind: 'break', pauseBefore: true }])).toBe(false)
    expect(sameSpans([{ kind: 'break', pauseBefore: 500 }], [{ kind: 'break', pauseBefore: 500 }])).toBe(true)
  })
})

describe('plainText', () => {
  it('break → 换行，文本顺序拼接', () => {
    expect(plainText([{ text: '上' }, { kind: 'break' }, { text: '下', bold: true }])).toBe('上\n下')
  })
})
