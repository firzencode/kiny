import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { story } from './_test-helpers'
import { makeVariants } from './variants'
import { makeRng } from './rng'

describe('runtime 3f② —— 变体（循环经过同一 site）', () => {
  function loopTexts(variant: string, rounds: number): string[] {
    const src = ['~ let n = 0', '=== A ===', `潮{ ${variant} }`, '~ n += 1', '+ {n < ' + rounds + '} [再] -> A', '* -> END'].join('\n')
    const s = story(src)
    const out: string[] = []
    for (;;) {
      while (s.canContinue) { const e = s.continue(); if (e.kind === 'text') out.push(plainText(e.spans)) }
      if (s.currentChoices.length > 0) s.choose(0); else break
    }
    return out
  }
  it('seq 停在最后一项', () => {
    expect(loopTexts('seq("a","b","c")', 5)).toEqual(['潮a', '潮b', '潮c', '潮c', '潮c'])
  })
  it('cycle 循环', () => {
    expect(loopTexts('cycle("a","b")', 5)).toEqual(['潮a', '潮b', '潮a', '潮b', '潮a'])
  })
  it('once 用完为空', () => {
    expect(loopTexts('once("a","b")', 4)).toEqual(['潮a', '潮b', '潮', '潮'])
  })
  it('同一 {} 内两个变体各自计数', () => {
    const out = loopTexts('cycle("x","y") + once("p")', 3)
    expect(out).toEqual(['潮xp', '潮y', '潮x'])
  })
})

describe('runtime 变体 —— 计数器 export/import', () => {
  it('exportCounters 反映 bump 次数，importCounters 接续', () => {
    const v1 = makeVariants(makeRng(1))
    v1.fns.seq('a', 'x', 'y', 'z')
    v1.fns.seq('a', 'x', 'y', 'z')
    expect(v1.exportCounters()).toEqual({ a: 2 })

    const v2 = makeVariants(makeRng(1))
    v2.importCounters({ a: 2 })
    expect(v2.fns.seq('a', 'x', 'y', 'z')).toBe('z') // 第 3 次：min(2, len-1=2) → 'z'
  })
})
