import { describe, it, expect } from 'vitest'
import { spanStyle } from './spanStyle'

describe('spanStyle（打字中 RevealingLine 与定格 RichText 共用的样式映射，Q2）', () => {
  it('bold → fontWeight 700', () => {
    expect(spanStyle({ text: 'x', bold: true })).toEqual({ fontWeight: 700 })
  })
  it('italic → fontStyle italic', () => {
    expect(spanStyle({ text: 'x', italic: true })).toEqual({ fontStyle: 'italic' })
  })
  it('underline + strike → 合并 textDecoration', () => {
    expect(spanStyle({ text: 'x', underline: true, strike: true }))
      .toEqual({ textDecoration: 'underline line-through' })
  })
  it('color / size → color、fontSize(em)', () => {
    expect(spanStyle({ text: 'x', color: '#c33', size: 1.5 }))
      .toEqual({ color: '#c33', fontSize: '1.5em' })
  })
  it('无样式 span → 空对象（RichText 据此不包裹纯文本）', () => {
    expect(spanStyle({ text: 'x' })).toEqual({})
  })
})
