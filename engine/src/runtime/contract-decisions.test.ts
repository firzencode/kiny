import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory, restoreStory } from './index'
import { fingerprint } from './snapshot'
import { plainText } from './spans'
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
const roundtrip = (s: Story) => JSON.parse(JSON.stringify(s.serialize()))

// 决策 A11：指纹去源码行号、改结构序号。
describe('T069 A11 —— 指纹去行号', () => {
  it('choice 前加注释行 → 指纹不变（加注释不毁旧存档）', () => {
    const base = ['=== A ===', '* x -> END', '* y -> END'].join('\n')
    const withComment = ['=== A ===', '// 一行注释', '* x -> END', '* y -> END'].join('\n')
    expect(fingerprint(prog(base))).toBe(fingerprint(prog(withComment)))
  })
  it('结构性增删 choice → 指纹变（旧存档正确失效）', () => {
    const two = ['=== A ===', '* x -> END', '* y -> END'].join('\n')
    const one = ['=== A ===', '* x -> END'].join('\n')
    expect(fingerprint(prog(two))).not.toBe(fingerprint(prog(one)))
  })
  it('加注释后旧存档仍可 restore（指纹一致）', () => {
    const base = prog(['=== A ===', '* x -> END', '* y -> END'].join('\n'))
    const s = createStory(base, { start: 'A' })
    drainText(s)
    const snap = roundtrip(s)
    const withComment = prog(['// 顶部注释', '=== A ===', '* x -> END', '* y -> END'].join('\n'))
    const r = restoreStory(withComment, snap)
    expect(r.ok).toBe(true) // 指纹不因注释行失配
  })
})

// 决策 B2：canContinue 幂等只读缓存（修 A3）。
describe('T069 B2 —— canContinue 幂等', () => {
  it('暂停点重复读 canContinue 一致、不重复求值选项条件副作用', () => {
    const src = ['~ let n = 0', '=== A ===', '* {(n = n + 1) > 0} 选 -> R', '=== R ===', 'n={n}', '-> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    drainText(s) // 推进到选项：条件求值一次 n=1
    for (let i = 0; i < 5; i++) expect(s.canContinue).toBe(false) // 停在选项，重复读稳定
    s.choose(0)
    // '选' 是选项点击正文，'n=1' 证明条件只求值一次（重复 canContinue 未累加 n）。
    expect(drainText(s)).toEqual(['选', 'n=1'])
  })
  it('末段 flush 边界重复读 canContinue 稳定', () => {
    const s = createStory(prog(['=== A ===', '只一行', '-> END'].join('\n')), { start: 'A' })
    const a = s.canContinue
    expect(a).toBe(true)
    expect(s.canContinue).toBe(true) // 幂等
    expect(s.continue().kind).toBe('text')
    expect(s.canContinue).toBe(false) // 推进后失效重算
  })
})

// 决策 B7：shuffle 删死写、纯随机 determinism 不变。
describe('T069 B7 —— shuffle 删死写', () => {
  it('固定 seed shuffle 可重复；serialize→restore 续跑等价', () => {
    const src = ['=== A ===', '{shuffle("甲","乙","丙")}', '* 再 -> A', '* 停 -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A', seed: 5 })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 续跑 shuffle 序列一致（删 bump 不改 determinism）
  })
})

// 决策 A8：空即无行。
describe('T069 A8 —— 空即无行', () => {
  it('{""} 独立行不产 text 事件', () => {
    const s = createStory(prog(['=== A ===', '{""}', '实文本', '-> END'].join('\n')), { start: 'A' })
    expect(drainText(s)).toEqual(['实文本']) // 无空行
  })
  it('{cond ? "文字" : ""} 假分支不产空行', () => {
    const src = ['~ let f = false', '=== A ===', '{f ? "有" : ""}', '尾', '-> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    expect(drainText(s)).toEqual(['尾'])
  })
  it('once 用尽返回空 → 无空行（不是空串行）', () => {
    // 用 `[再]`/`[停]` 括号选项（点击正文为空）隔离，使 drainText 只反映 once 行的成/不成行。
    const src = ['=== A ===', '{once("甲")}', '* [再] -> A', '* [停] -> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    expect(drainText(s)).toEqual(['甲']) // 第一次
    s.choose(0)
    expect(drainText(s)).toEqual([]) // 第二次 once 用尽 → 空 → 无行（旧行为为 ['']）
  })
  it('glue 链中的空插值不误丢（前后仍拼一行）', () => {
    // 前{""}后 单行内空 interp 本就被 renderSpans 跳过、渲染「前后」；此处验证行内空插值不影响成行。
    const s = createStory(prog(['=== A ===', '前{""}后', '-> END'].join('\n')), { start: 'A' })
    expect(drainText(s)).toEqual(['前后'])
  })
})
