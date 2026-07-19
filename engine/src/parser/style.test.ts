import { describe, it, expect } from 'vitest'
import { sameStyle } from './style'

describe('sameStyle —— 内联样式等价', () => {
  it('两侧皆 undefined 视为等价', () => expect(sameStyle(undefined, undefined)).toBe(true))
  it('一有一无视为不同', () => {
    expect(sameStyle({ bold: true }, undefined)).toBe(false)
    expect(sameStyle(undefined, { bold: true })).toBe(false)
  })
  it('同布尔标志等价（false 与缺省等同）', () => {
    expect(sameStyle({ bold: true }, { bold: true })).toBe(true)
    expect(sameStyle({}, { bold: false })).toBe(true)
    expect(sameStyle({ bold: true }, { bold: false })).toBe(false)
  })
  it('color / size 精确比较', () => {
    expect(sameStyle({ color: '#f00' }, { color: '#f00' })).toBe(true)
    expect(sameStyle({ color: '#f00' }, { color: '#00f' })).toBe(false)
    expect(sameStyle({ size: 2 }, { size: 2 })).toBe(true)
    expect(sameStyle({ size: 2 }, { size: 3 })).toBe(false)
  })
})
