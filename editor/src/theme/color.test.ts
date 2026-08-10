import { describe, it, expect } from 'vitest'
import { parseColor, formatColor, mixWithText } from './color'

describe('parseColor', () => {
  it('十六进制三位 / 六位 / 八位', () => {
    expect(parseColor('#ABC')).toEqual({ hex: '#aabbcc', alpha: 1 })
    expect(parseColor(' #0D1117 ')).toEqual({ hex: '#0d1117', alpha: 1 })
    expect(parseColor('#0d111780')).toEqual({ hex: '#0d1117', alpha: 0.5 })
  })

  it('rgb() / rgba()（作品主题里的半透明值多是这个形态）', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ hex: '#ff0000', alpha: 1 })
    expect(parseColor('rgba(255, 255, 255, .35)')).toEqual({ hex: '#ffffff', alpha: 0.35 })
    expect(parseColor('rgba(10,14,20,0.55)')).toEqual({ hex: '#0a0e14', alpha: 0.55 })
  })

  it('transparent = 全透明黑（面板底色的默认值）', () => {
    expect(parseColor('transparent')).toEqual({ hex: '#000000', alpha: 0 })
  })

  it('表达不了的形态 → null（该字段退化为文本输入）', () => {
    expect(parseColor('color-mix(in srgb, var(--kiny-text) 62%, transparent)')).toBeNull()
    expect(parseColor('red')).toBeNull()
    expect(parseColor('var(--x)')).toBeNull()
    expect(parseColor('rgba(255, 0, 0)')).toBeNull() // rgba 缺 alpha：不猜
  })
})

describe('formatColor', () => {
  it('不透明 → 六位十六进制（作者手写时最常见的形态）', () => {
    expect(formatColor('#0d1117', 1)).toBe('#0d1117')
  })

  it('半透明 → rgba()，小数不带前导 0（与 player 既有写法一致）', () => {
    expect(formatColor('#ffffff', 0.35)).toBe('rgba(255, 255, 255, .35)')
    expect(formatColor('#0a0e14', 0.55)).toBe('rgba(10, 14, 20, .55)')
  })

  it('全透明 → transparent', () => {
    expect(formatColor('#000000', 0)).toBe('transparent')
  })

  it('先按两位小数定档再分流：.999 是不透明、.004 是全透明，不产出 rgba(…, 1) / rgba(…, 0)', () => {
    expect(formatColor('#112233', 0.999)).toBe('#112233')
    expect(formatColor('#112233', 0.004)).toBe('transparent')
  })

  it('越界 / 非数 alpha 按不透明处理，绝不把 NaN 写进作者的文件', () => {
    expect(formatColor('#112233', Number.NaN)).toBe('#112233')
    expect(formatColor('#112233', 1.5)).toBe('#112233')
    expect(formatColor('#112233', -1)).toBe('transparent')
  })

  it('与 parseColor 往返无损', () => {
    for (const v of ['#0d1117', 'rgba(255, 255, 255, .35)', 'transparent', 'rgba(10, 14, 20, .55)']) {
      const p = parseColor(v)!
      expect(formatColor(p.hex, p.alpha), v).toBe(v)
    }
  })
})

describe('mixWithText（面板类 token 的推导默认值）', () => {
  it('按百分比把正文色掺进透明，等价于 player 的 color-mix', () => {
    expect(mixWithText('#e8e8e8', 0.62)).toBe('rgba(232, 232, 232, .62)')
    expect(mixWithText('#e8e8e8', 0.12)).toBe('rgba(232, 232, 232, .12)')
  })

  it('正文色本身表达不了时回退 null（GUI 该项退化为文本输入）', () => {
    expect(mixWithText('color-mix(in srgb, red 50%, blue)', 0.62)).toBeNull()
  })
})
