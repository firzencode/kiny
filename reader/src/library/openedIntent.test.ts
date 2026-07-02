import { describe, it, expect } from 'vitest'
import { normalizeOpenedUris } from './openedIntent'

describe('normalizeOpenedUris', () => {
  it('保留字符串、按出现序去重、去首尾空白、丢弃空串', () => {
    expect(normalizeOpenedUris(['content://a', ' content://b ', 'content://a', '', '   '])).toEqual([
      'content://a',
      'content://b',
    ])
  })

  it('非数组载荷 → 空数组', () => {
    expect(normalizeOpenedUris(undefined)).toEqual([])
    expect(normalizeOpenedUris(null)).toEqual([])
    expect(normalizeOpenedUris('content://x')).toEqual([])
  })

  it('跳过非字符串条目', () => {
    expect(normalizeOpenedUris(['file:///x.kip', 42, null, { u: 1 }, 'file:///y.kip'])).toEqual([
      'file:///x.kip',
      'file:///y.kip',
    ])
  })
})
