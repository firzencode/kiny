import { describe, it, expect } from 'vitest'
import { sortByPath } from './order'

describe('sortByPath —— path 字典序', () => {
  it('按 path 升序排列', () => {
    const items = [{ path: 'b.kin' }, { path: 'a.kin' }, { path: 'c.kin' }]
    expect(sortByPath(items).map((x) => x.path)).toEqual(['a.kin', 'b.kin', 'c.kin'])
  })

  it('返回新数组、不改动原数组', () => {
    const items = [{ path: 'b' }, { path: 'a' }]
    const sorted = sortByPath(items)
    expect(sorted).not.toBe(items)
    expect(items.map((x) => x.path)).toEqual(['b', 'a']) // 原序未变
  })

  it('字节序而非 locale：大写 Z 排在小写 a 之前', () => {
    expect(sortByPath([{ path: 'a' }, { path: 'Z' }]).map((x) => x.path)).toEqual(['Z', 'a'])
  })
})
