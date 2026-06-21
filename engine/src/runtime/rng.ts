export interface Rng {
  next(): number      // [0,1)
  reseed(n: number): void
  state(): number          // 取当前内部状态（用于状态快照）
  setState(n: number): void // 恢复内部状态
}

/** mulberry32：小巧确定性 PRNG。 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    next(): number {
      a |= 0; a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    reseed(n: number): void { a = n >>> 0 },
    state(): number { return a >>> 0 },
    setState(n: number): void { a = n >>> 0 },
  }
}
