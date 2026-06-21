import { describe, it, expect } from 'vitest'
import { makeRng } from './rng'

describe('runtime rng —— 确定性', () => {
  it('同种子同序列', () => {
    const a = makeRng(42), b = makeRng(42)
    const sa = [a.next(), a.next(), a.next()]
    const sb = [b.next(), b.next(), b.next()]
    expect(sa).toEqual(sb)
  })
  it('next 落在 [0,1)', () => {
    const r = makeRng(1)
    for (let i = 0; i < 100; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
  it('reseed 重置序列', () => {
    const r = makeRng(7); const first = r.next()
    r.reseed(7); expect(r.next()).toBe(first)
  })
  it('state/setState 从断点接续序列', () => {
    const r = makeRng(123)
    for (let i = 0; i < 5; i++) r.next() // 推进到第 5 步后
    const s = r.state()
    const rest = [r.next(), r.next(), r.next()] // 原 rng 第 6~8 步

    const r2 = makeRng(0)
    r2.setState(s)
    expect([r2.next(), r2.next(), r2.next()]).toEqual(rest)
  })
})
