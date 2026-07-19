import { describe, it, expect } from 'vitest'
import { tailByBytes } from './platform'

/** Q6：readRecentLog 的近期日志尾部按 UTF-8 字节截断（旧实现按 UTF-16 字符数）+ 对齐行边界。 */
describe('tailByBytes', () => {
  it('不超上限时原样返回', () => {
    expect(tailByBytes('abc\ndef', 100)).toBe('abc\ndef')
  })

  it('按字节截断并对齐行边界（丢弃开头被切碎的不完整行）', () => {
    const text = 'line1\nline2\nline3\n'
    // 取末尾约 8 字节 ≈ "e3\n" 附近，落在某行中间 → 对齐到下一行边界后无残缺半行。
    const out = tailByBytes(text, 8)
    expect(out.length).toBeGreaterThan(0)
    // 结果不含开头的半行：不以「被切断的行片段」开头——每个非空行都是完整的 lineN。
    for (const ln of out.split('\n').filter(Boolean)) expect(ln).toMatch(/^line\d$/)
  })

  it('按 UTF-8 字节而非 UTF-16 字符计（中文每字 3 字节）', () => {
    const cn = '中'.repeat(100) // 100 字符 = 300 字节
    const out = tailByBytes(cn, 30) // 30 字节 ≈ 10 个「中」
    // 旧的按 .length（字符）会返回末 30 字符；按字节应远少于 30 字符。
    expect(out.length).toBeLessThan(30)
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(30)
  })
})
