import { describe, it, expect } from 'vitest'
import { SPEC_SECTIONS } from './kinSpecData'

// 防真实规范改格式悄悄破坏解析：断言解析非空且关键 id 在册。
describe('Kin 规范资产解析（冒烟）', () => {
  it('解析出足量章节，关键 id 存在', () => {
    expect(SPEC_SECTIONS.length).toBeGreaterThan(10)
    const ids = SPEC_SECTIONS.map((s) => s.id)
    expect(ids).toContain('5.3') // 条件选项
    expect(ids).toContain('7.7') // 边界
  })
})
