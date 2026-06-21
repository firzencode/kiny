import { describe, it, expect } from 'vitest'
import { story, drain } from './_test-helpers'

describe('runtime 3a —— 线性文本 / END', () => {
  it('连续文本行各产出一个 text 事件', () => {
    const s = story('=== A ===\n第一行\n第二行\n-> END')
    expect(drain(s)).toEqual([
      { kind: 'text', text: '第一行' },
      { kind: 'text', text: '第二行' },
    ])
    expect(s.hasEnded).toBe(true)
  })
  it('触底无跳转也结束', () => {
    const s = story('=== A ===\n只有一行')
    expect(drain(s)).toEqual([{ kind: 'text', text: '只有一行' }])
    expect(s.hasEnded).toBe(true)
  })
})
