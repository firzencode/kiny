import { describe, it, expect } from 'vitest'
import { findInterpEnd } from './interp'

describe('findInterpEnd', () => {
  it('返回配平 } 之后的下标', () => {
    expect(findInterpEnd('{a}', 0)).toBe(3)
    expect(findInterpEnd('前{a}后', 1)).toBe(4)
  })

  it('处理嵌套花括号', () => {
    expect(findInterpEnd('{a{b}c}', 0)).toBe(7)
  })

  it('识别字符串字面量，跳过串内的 }', () => {
    expect(findInterpEnd('{"a}b"}', 0)).toBe(7)
    expect(findInterpEnd("{'x}'}", 0)).toBe(6)
    expect(findInterpEnd('{`y}`}', 0)).toBe(6)
  })

  it('串内转义引号不算闭合', () => {
    // 运行时串为 {"a\"}b"} ——\" 是转义引号，字符串到索引7的 " 才闭合，真正的 } 在索引8
    expect(findInterpEnd('{"a\\"}b"}', 0)).toBe(9)
  })

  it('\\} 不计入配平', () => {
    expect(findInterpEnd('{a\\}b}', 0)).toBe(6)
  })

  it('不配平返回 -1', () => {
    expect(findInterpEnd('{a', 0)).toBe(-1)
    expect(findInterpEnd('{a{b}', 0)).toBe(-1)
  })
})
