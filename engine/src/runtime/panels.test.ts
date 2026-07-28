import { describe, it, expect } from 'vitest'
import { story, storyFromEntry } from './_test-helpers'
import { restoreStory } from './index'
import { analyze } from '../analyze'
import { parse } from '../parser'
import { plainText } from './spans'
import type { OutputEvent } from './types'

/** 跑到不能推进，收集 panel 事件（槽位 + 纯文本）。 */
function panelTrace(s: ReturnType<typeof story>): { slot: string; text: string }[] {
  const out: { slot: string; text: string }[] = []
  while (s.canContinue) {
    const e: OutputEvent = s.continue()
    if (e.kind === 'panel') out.push({ slot: e.slot, text: plainText(e.spans) })
  }
  return out
}

describe('@panel —— 登记与重估', () => {
  it('登记后立刻发一次 panel 事件（活模板求值结果）', () => {
    const src = ['~ let hp = 10', '=== A ===', '@panel("left", "HP: {hp}")', '开场。', '-> END'].join('\n')
    expect(panelTrace(story(src))).toEqual([{ slot: 'left', text: 'HP: 10' }])
  })

  it('变量变化才发事件：不变的步不重复发', () => {
    const src = [
      '~ let hp = 10',
      '=== A ===',
      '@panel("left", "HP: {hp}")',
      '第一行。',
      '第二行。', // hp 没变 → 不该再发
      '~ hp = 3',
      '第三行。', // hp 变了 → 发一次
      '-> END',
    ].join('\n')
    expect(panelTrace(story(src))).toEqual([
      { slot: 'left', text: 'HP: 10' },
      { slot: 'left', text: 'HP: 3' },
    ])
  })

  it('四槽独立；同槽再次 @panel = 整体替换模板', () => {
    const src = [
      '=== A ===',
      '@panel("left", "左")',
      '@panel("right", "右")',
      '@panel("bottom", "下")',
      '@panel("left", "新左")',
      '正文。',
      '-> END',
    ].join('\n')
    expect(panelTrace(story(src))).toEqual([
      { slot: 'left', text: '新左' }, // 替换后只发最终值（登记不求值，重估在事件边界）
      { slot: 'right', text: '右' },
      { slot: 'bottom', text: '下' },
    ])
  })

  it('空串 = 清空并隐藏该槽（发一次空 spans 事件）', () => {
    const src = ['=== A ===', '@panel("left", "有内容")', '一行。', '@panel("left", "")', '又一行。', '-> END'].join('\n')
    const trace = panelTrace(story(src))
    expect(trace).toEqual([
      { slot: 'left', text: '有内容' },
      { slot: 'left', text: '' },
    ])
  })

  it('模板支持富文本与 <br>（spans 而非纯文本）', () => {
    const src = ['~ let hp = 5', '=== A ===', '@panel("left", "<b>状态</b><br>HP: {hp}")', '正文。', '-> END'].join('\n')
    const s = story(src)
    let spans: unknown = null
    while (s.canContinue) {
      const e = s.continue()
      if (e.kind === 'panel') spans = e.spans
    }
    expect(spans).toEqual([
      { text: '状态', bold: true },
      { kind: 'break' },
      { text: 'HP: 5' },
    ])
  })

  it('模板里的 <pause> 被忽略（面板无揭示流程）', () => {
    const src = ['=== A ===', '@panel("left", "前<pause>后")', '正文。', '-> END'].join('\n')
    const s = story(src)
    let spans: unknown = null
    while (s.canContinue) {
      const e = s.continue()
      if (e.kind === 'panel') spans = e.spans
    }
    expect(spans).toEqual([{ text: '前后' }]) // 无 pauseBefore、且照常归并
  })

  // 运行期未知槽位无法从合法脚本抵达——槽位必须是字符串字面量、由 analyze 前置拦下
  //（见 checks/commands.test.ts 的 panel-slot 用例）。registerPanel 里的槽名校验是纯防御，
  // 只在「跨版本存档带来陌生槽位」这类场景兜底。

  it('模板求值出错按运行时错误报（与正文插值同待遇）', () => {
    const src = ['~ let o = null', '=== A ===', '@panel("left", "{o.x}")', '正文。', '-> END'].join('\n')
    expect(() => panelTrace(story(src))).toThrow()
  })

  it('面板更新紧跟其所属那一行之后（正文先出、面板随后）', () => {
    const src = ['~ let hp = 1', '=== A ===', '@panel("left", "HP: {hp}")', '甲。', '~ hp = 2', '乙。', '-> END'].join('\n')
    const s = story(src)
    const trace: string[] = []
    while (s.canContinue) {
      const e = s.continue()
      if (e.kind === 'text') trace.push(`T ${plainText(e.spans)}`)
      else if (e.kind === 'panel') trace.push(`P ${plainText(e.spans)}`)
    }
    // 重估发生在「行成形」的那个事件边界上，文本先 flush、面板随后——同一次推进内都到达宿主。
    expect(trace).toEqual(['T 甲。', 'P HP: 1', 'T 乙。', 'P HP: 2'])
  })
})

describe('@panel —— 快照往返', () => {
  const SRC = ['~ let hp = 7', '=== A ===', '@panel("left", "HP: {hp}")', '停一下。', '* [继续] -> END'].join('\n')

  function build(src: string) {
    const program = analyze([parse(src, 'main.kin')]).program
    if (!program) throw new Error('analyze 失败')
    return program
  }

  it('模板本体入快照；restore 后重登记并立刻重估（读档即渲染）', () => {
    const program = build(SRC)
    const s = story(SRC) // 从 knot A 起跑（开场只有 preamble，无内容无跳转）
    while (s.canContinue) s.continue() // 跑到选项暂停点
    const snap = s.serialize()
    expect(snap.panels).toEqual({ left: 'HP: {hp}' })

    const r = restoreStory(program, snap)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 读档后：模板重登记、last 为空 → 首次重估必发事件，宿主据此立刻渲染
    const trace = panelTrace(r.story)
    expect(trace).toEqual([{ slot: 'left', text: 'HP: 7' }])
  })

  it('restore 后 panels 与现场播放逐字节一致（含 <pause> 剥离 + 富文本）', () => {
    // 回归：restore 重登记若不剥 <pause>，读档后的 panel spans 会与现场播放分叉。
    const src = ['~ let hp = 9', '=== A ===', '@panel("left", "<b>前</b><pause>后 HP:{hp}")', '一行。', '* [继续] -> END'].join('\n')
    const program = build(src)

    // 现场播放：跑到暂停点，取 left 的最终 spans。
    const live = story(src)
    let liveSpans: unknown = null
    while (live.canContinue) { const e = live.continue(); if (e.kind === 'panel') liveSpans = e.spans }

    // 读档：serialize → restore → 重估。
    const seed = story(src)
    while (seed.canContinue) seed.continue()
    const r = restoreStory(program, seed.serialize())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    let restoredSpans: unknown = null
    while (r.story.canContinue) { const e = r.story.continue(); if (e.kind === 'panel') restoredSpans = e.spans }

    expect(restoredSpans).toEqual(liveSpans)
    expect(restoredSpans).toEqual([{ text: '前', bold: true }, { text: '后 HP:9' }]) // <pause> 已剥、无 pauseBefore
  })

  it('无面板的故事快照不带 panels 字段（旧存档形状不变）', () => {
    const src = '=== A ===\n一行。\n* [继续] -> END'
    const s = storyFromEntry(src)
    while (s.canContinue) s.continue()
    expect(s.serialize().panels).toBeUndefined()
  })

  it('快照版本升到 4（旧版存档判 corrupt）', () => {
    const program = build(SRC)
    const s = story(SRC) // 从 knot A 起跑（开场只有 preamble，无内容无跳转）
    while (s.canContinue) s.continue()
    const snap = s.serialize()
    expect(snap.version).toBe(4)
    const old = { ...snap, version: 3 } as unknown as Parameters<typeof restoreStory>[1]
    expect(restoreStory(program, old)).toEqual({ ok: false, reason: 'corrupt' })
  })
})
