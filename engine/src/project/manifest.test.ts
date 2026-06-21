import { describe, it, expect } from 'vitest'
import { validateManifest } from './manifest'

const ok = { name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }

describe('validateManifest', () => {
  it('四字段齐全 → 返回 KinyMeta', () => {
    expect(validateManifest(ok)).toEqual(ok)
  })
  it('非对象 → 报错', () => {
    expect(validateManifest(42)).toEqual(['kiny.json 不是 JSON 对象'])
    expect(validateManifest(null)).toEqual(['kiny.json 不是 JSON 对象'])
    expect(validateManifest(['a'])).toEqual(['kiny.json 不是 JSON 对象'])
  })
  it('缺字段一次报全', () => {
    const r = validateManifest({ name: 'x' })
    expect(Array.isArray(r)).toBe(true)
    expect(r as string[]).toHaveLength(3) // version / engine / entry
  })
  it('空串字段算非法', () => {
    expect(validateManifest({ ...ok, entry: '   ' })).toEqual(['缺少或非法字段: entry（须为非空字符串）'])
  })
  it('类型错字段算非法', () => {
    expect(validateManifest({ ...ok, version: 100 })).toEqual(['缺少或非法字段: version（须为非空字符串）'])
  })
})
