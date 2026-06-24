import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory, restoreStory } from './index'
import type { Story } from './story'

function prog(src: string) {
  const p = analyze([parse(src, 'main.kin')]).program
  if (!p) throw new Error('analyze 有 error，fixture 不合法')
  return p
}

function drainText(s: Story): string[] {
  const out: string[] = []
  while (s.canContinue) {
    const e = s.continue()
    if (e.kind === 'text') out.push(plainText(e.spans))
  }
  return out
}

/** JSON 往返一遍，模拟落盘读回。 */
function roundtrip(s: Story) {
  return JSON.parse(JSON.stringify(s.serialize()))
}

describe('Story 状态快照 —— 往返等价', () => {
  it('等待选择边界：serialize → JSON 往返 → restore 续读与不中断一致', () => {
    const src = ['=== A ===', '开场', '* 选一 -> B', '* 选二 -> C', '=== B ===', 'B正文', '-> END', '=== C ===', 'C正文', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['选一', '选二'])

    const snap = roundtrip(s)
    const r = restoreStory(program, snap)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s2 = r.story
    expect(s2.currentChoices.map((c) => plainText(c.spans))).toEqual(['选一', '选二'])

    s.choose(0)
    s2.choose(0)
    expect(drainText(s2)).toEqual(drainText(s))
  })

  it('嵌套 choice body 内选项（栈多层）往返等价', () => {
    const src = [
      '=== A ===',
      '* [外选一]',
      '> 进入外选一',
      '> * [内选一] -> B',
      '> * [内选二] -> C',
      '* [外选二] -> D',
      '=== B ===', 'B正文', '-> END',
      '=== C ===', 'C正文', '-> END',
      '=== D ===', 'D正文', '-> END',
    ].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['外选一', '外选二'])
    s.choose(0) // 进外选一 body
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['内选一', '内选二']) // 栈多层

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.story.currentChoices.map((c) => plainText(c.spans))).toEqual(['内选一', '内选二'])
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s))
  })

  it('已结束边界：restore 后 hasEnded 真、无选项', () => {
    const src = ['=== A ===', '只有一行', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.hasEnded).toBe(true)

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.story.hasEnded).toBe(true)
    expect(r.story.currentChoices).toEqual([])
  })

  it('rng 连续性：restore 后 random 续出与不中断一致', () => {
    const src = ['=== A ===', '骰{random(1,6)}{random(1,6)}{random(1,6)}', '* 再 -> A', '* 停 -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A', seed: 42 })
    drainText(s) // 第一轮骰子
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 第二轮骰子序列一致
  })

  it('变体计数跨快照：once 不重置不跳号', () => {
    const src = ['=== A ===', '{ once("甲","乙","丙") }', '* 再 -> A', '* 停 -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    expect(drainText(s)).toContain('甲') // 第一次
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 续读应出 '乙'，两边一致
  })

  it('指纹失配：改 program 后 restore 返回 fingerprint-mismatch', () => {
    const src = ['=== A ===', '* x -> END', '* y -> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    drainText(s)
    const snap = roundtrip(s)
    const other = prog(['=== A ===', '* x -> END'].join('\n')) // 删一个选项
    const r = restoreStory(other, snap)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('fingerprint-mismatch')
  })

  it('非稳定边界 serialize 抛错', () => {
    const src = ['=== A ===', '第一行', '第二行', '-> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    expect(s.canContinue).toBe(true) // 有待 flush 文本，非稳定边界
    expect(() => s.serialize()).toThrow()
  })
})
