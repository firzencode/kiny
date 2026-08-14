import { describe, it, expect } from 'vitest'
import { parseCharacters, slotColor, slotHexApprox, SLOT_HUES } from './table'

const auto = (hue: number) => `oklch(from var(--kiny-text) l 0.11 ${hue})`

describe('parseCharacters', () => {
  it('按声明顺序分配八个色相槽', () => {
    const t = parseCharacters('{"甲":{},"乙":{},"丙":{}}', { autoColor: true })
    expect([...t.keys()]).toEqual(['甲', '乙', '丙'])
    expect(t.get('甲')).toBe(auto(0))
    expect(t.get('乙')).toBe(auto(45))
    expect(t.get('丙')).toBe(auto(90))
  })

  it('第九个角色起循环复用槽位', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const t = parseCharacters(JSON.stringify(Object.fromEntries(names.map((n) => [n, {}]))), { autoColor: true })
    expect(t.get('i')).toBe(t.get('a'))
    expect(t.get('h')).toBe(auto(315))
  })

  it('作者写死的 color 覆盖自动分配，且照常占一个槽位', () => {
    const t = parseCharacters('{"甲":{"color":"#7fb3d5"},"乙":{}}', { autoColor: true })
    expect(t.get('甲')).toBe('#7fb3d5')
    expect(t.get('乙')).toBe(auto(45))
  })

  it('不支持相对颜色时只留写死颜色的角色', () => {
    const t = parseCharacters('{"甲":{"color":"#7fb3d5"},"乙":{}}', { autoColor: false })
    expect(t.get('甲')).toBe('#7fb3d5')
    expect(t.has('乙')).toBe(false)
  })

  it('缺失 / 空 / 非法 JSON / 非对象顶层 → 空表，不抛', () => {
    const bads: (string | null | undefined)[] = [null, undefined, '', '   ', '{', '[]', '"x"', '42', 'null']
    for (const bad of bads) {
      expect(parseCharacters(bad, { autoColor: true }).size).toBe(0)
    }
  })

  it('值形状不对的条目被丢弃，其余照常', () => {
    const t = parseCharacters('{"甲":"红","乙":{},"丙":null,"丁":{"color":42}}', { autoColor: true })
    expect([...t.keys()]).toEqual(['乙', '丁'])
    // 丁 的 color 非字符串 → 当作没写，走自动分配；槽位按保留下来的顺序
    expect(t.get('乙')).toBe(auto(0))
    expect(t.get('丁')).toBe(auto(45))
  })

  it('名字含 < > : ： 或换行的条目被丢弃', () => {
    const t = parseCharacters('{"a<b":{},"a>b":{},"a:b":{},"a：b":{},"a\\nb":{},"好":{}}', { autoColor: true })
    expect([...t.keys()]).toEqual(['好'])
  })

  it('空名字被丢弃', () => {
    expect(parseCharacters('{"":{}}', { autoColor: true }).size).toBe(0)
  })

  it('color 为空串 / 纯空白当作没写', () => {
    const t = parseCharacters('{"甲":{"color":"   "}}', { autoColor: true })
    expect(t.get('甲')).toBe(auto(0))
  })
})

describe('槽位配色', () => {
  it('slotColor 循环取八个色相，编辑器取色器的起始 hex 与之一一对应', () => {
    expect(SLOT_HUES).toHaveLength(8)
    expect(slotColor(0)).toBe(slotColor(8))
    expect(slotHexApprox(0)).toBe(slotHexApprox(8))
    // 八个近似色互不相同——重了就说明它们不是从八个不同色相算出来的。
    expect(new Set(SLOT_HUES.map((_, i) => slotHexApprox(i))).size).toBe(8)
  })
})
