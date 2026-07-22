import { describe, it, expect } from 'vitest'
import { readDisplayMeta } from './displayMeta'

describe('readDisplayMeta', () => {
  it('齐全字段 → 全部返回', () => {
    const text = JSON.stringify({
      name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin',
      author: '佚名', cover: 'assets/c.jpg', description: '一个测试故事',
    })
    expect(readDisplayMeta(text)).toEqual({
      name: '雾港之夜', author: '佚名', cover: 'assets/c.jpg', description: '一个测试故事',
    })
  })

  it('缺可选字段 → 对应 undefined', () => {
    const text = JSON.stringify({ name: '简故事', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
    expect(readDisplayMeta(text)).toEqual({ name: '简故事', author: undefined, cover: undefined, description: undefined })
  })

  it('非 JSON 对象 → 抛错', () => {
    expect(() => readDisplayMeta('not json')).toThrow()
    expect(() => readDisplayMeta('123')).toThrow()
  })

  it('缺 name → 抛错', () => {
    expect(() => readDisplayMeta(JSON.stringify({ version: '1.0.0' }))).toThrow()
  })

  it('非字符串可选字段 → undefined', () => {
    const text = JSON.stringify({ name: 'x', author: 123, cover: false, description: null })
    expect(readDisplayMeta(text)).toEqual({ name: 'x', author: undefined, cover: undefined, description: undefined })
  })
})
