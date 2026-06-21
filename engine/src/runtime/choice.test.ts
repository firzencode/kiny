import { describe, it, expect } from 'vitest'
import { story, play } from './_test-helpers'

describe('runtime 3c —— 选项', () => {
  it('呈现选项文字 + 点击产出正文 + 跳转', () => {
    const src = ['=== A ===', '岔路', '* [走左] 你向左。 -> L', '* [走右] -> R', '=== L ===', '到了左边', '-> END', '=== R ===', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.choices[0]).toEqual(['走左', '走右'])
    expect(r.texts).toContain('你向左。')
    expect(r.texts).toContain('到了左边')
  })
  it('条件假的选项不显示', () => {
    const src = ['~ let g = 0', '=== A ===', '* {g >= 5} [买] -> X', '* [走] -> X', '=== X ===', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.choices[0]).toEqual(['走'])
  })
  it('一次性选项选过即消失，粘性保留', () => {
    const src = ['=== A ===', '* [一次] -> A', '+ [常驻] -> A', '* -> END'].join('\n')
    const r = play(story(src), [0, 0]) // 选一次性，再回到 A
    expect(r.choices[0]).toEqual(['一次', '常驻'])
    expect(r.choices[1]).toEqual(['常驻']) // 一次性已消失
  })
  it('选项全不可用时自动走 fallback', () => {
    const src = ['~ let tried = false', '=== A ===', '* {!tried} [试] -> T', '* -> 没招', '=== T ===', '~ tried = true', '-> A', '=== 没招 ===', '认输', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.texts).toContain('认输') // 第二轮无可见选项 → fallback
  })
  it('标签计数可读', () => {
    const src = ['=== A ===', '* (hi) [打招呼] -> B', '=== B ===', '打过{hi}次', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.texts).toContain('打过1次')
  })
})
