import { describe, it, expect } from 'vitest'
import { LruCache } from './lru'

describe('LruCache', () => {
  it('命中返回值；未命中返回 undefined', () => {
    const c = new LruCache<number>(3)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    expect(c.get('missing')).toBeUndefined()
  })

  it('容量满时逐出最久未用的键（上限生效，C2）', () => {
    const c = new LruCache<number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3) // 满 → 逐出最旧 a
    expect(c.size).toBe(2)
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
  })

  it('get 命中把键提为最新，改变逐出顺序（真 LRU 而非 FIFO）', () => {
    const c = new LruCache<number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // a 变最新 → 下次逐 b
    c.set('c', 3)
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(false)
    expect(c.has('c')).toBe(true)
  })

  it('重复 set 同键只更新值、不增长 size', () => {
    const c = new LruCache<number>(3)
    c.set('a', 1)
    c.set('a', 2)
    expect(c.size).toBe(1)
    expect(c.get('a')).toBe(2)
  })

  it('大量不同键写入 → size 恒不超过上限', () => {
    const c = new LruCache<number>(10)
    for (let i = 0; i < 100; i++) c.set(`k${i}`, i)
    expect(c.size).toBe(10)
    expect(c.has('k99')).toBe(true) // 最新一批在
    expect(c.has('k0')).toBe(false) // 最旧的早被逐出
  })
})
