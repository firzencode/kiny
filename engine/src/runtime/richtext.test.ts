import { describe, it, expect } from 'vitest'
import { story, drain } from './_test-helpers'
import type { OutputEvent } from './types'

/** 取 drain 后第 idx 个 text 事件的 spans。 */
function spansAt(s: ReturnType<typeof story>, idx = 0) {
  const texts = drain(s).filter((e): e is Extract<OutputEvent, { kind: 'text' }> => e.kind === 'text')
  return texts[idx]!.spans
}

describe('runtime 富文本渲染', () => {
  it('<b> 内文本产出 bold span，标签外为纯文本 span', () => {
    const s = story('=== A ===\n普通<b>粗体</b>。\n-> END')
    expect(spansAt(s)).toEqual([
      { text: '普通' },
      { text: '粗体', bold: true },
      { text: '。' },
    ])
  })

  it('嵌套样式叠加；颜色 / 字号落值', () => {
    const s = story('=== A ===\n<b><color=red>红粗</color></b><size=1.5>大</size>\n-> END')
    expect(spansAt(s)).toEqual([
      { text: '红粗', bold: true, color: 'red' },
      { text: '大', size: 1.5 },
    ])
  })

  it('<br> 产出换行 span', () => {
    const s = story('=== A ===\n上<br>下\n-> END')
    expect(spansAt(s)).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })

  it('插值承继样式，相邻同样式段归并', () => {
    const src = ['~ let n = 3', '=== A ===', '<b>有 {n} 个</b>', '-> END'].join('\n')
    const s = story(src)
    expect(spansAt(s)).toEqual([{ text: '有 3 个', bold: true }])
  })

  it('glue 跨行：两行 spans 合并为一个 text 事件，边界同样式归并', () => {
    const s = story('=== A ===\n甲<>\n乙\n-> END')
    const texts = drain(s).filter((e) => e.kind === 'text')
    expect(texts).toHaveLength(1)
    expect((texts[0] as Extract<OutputEvent, { kind: 'text' }>).spans).toEqual([{ text: '甲乙' }])
  })

  it('选项文本也产出富文本 spans', () => {
    const s = story('=== A ===\n* [<i>走</i>开] -> END')
    while (s.canContinue) s.continue()
    expect(s.currentChoices[0]!.spans).toEqual([
      { text: '走', italic: true },
      { text: '开' },
    ])
  })

  it('纯文本（无标签）恒为单个 {text} span（向后兼容）', () => {
    const s = story('=== A ===\n就是一行普通文本。\n-> END')
    expect(spansAt(s)).toEqual([{ text: '就是一行普通文本。' }])
  })
})
