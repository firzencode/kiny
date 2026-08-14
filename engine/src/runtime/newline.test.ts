import { describe, it, expect } from 'vitest'
import { story, drain } from './_test-helpers'
import type { RichSpan } from './spans'

/** drain 后取第 i 条 text 事件的 spans（默认首条）。 */
function spansOf(s: ReturnType<typeof story>, i = 0): RichSpan[] {
  const texts = drain(s).flatMap((e) => (e.kind === 'text' ? [e.spans] : []))
  return texts[i]!
}

describe('T113 —— 文本里的换行符等价于 <br>', () => {
  it('插值结果里的换行符切成 break span', () => {
    const s = story('~ let t = "上\\n下"\n=== A ===\n{t}\n-> END')
    expect(spansOf(s)).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })

  it('\\r\\n 归一为单个 break', () => {
    const s = story('~ let t = "上\\r\\n下"\n=== A ===\n{t}\n-> END')
    expect(spansOf(s)).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })

  it('单独的 \\r 也归一为 break', () => {
    const s = story('~ let t = "上\\r下"\n=== A ===\n{t}\n-> END')
    expect(spansOf(s)).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })

  it('尾随换行不修剪（所写即所得）', () => {
    const s = story('~ let t = "行\\n"\n=== A ===\n{t}\n-> END')
    expect(spansOf(s)).toEqual([{ text: '行' }, { kind: 'break' }])
  })

  it('行首换行不修剪', () => {
    const s = story('~ let t = "\\n行"\n=== A ===\n{t}\n-> END')
    expect(spansOf(s)).toEqual([{ kind: 'break' }, { text: '行' }])
  })

  it('连续换行产出连续 break', () => {
    const s = story('~ let t = "a\\n\\nb"\n=== A ===\n{t}\n-> END')
    expect(spansOf(s)).toEqual([{ text: 'a' }, { kind: 'break' }, { kind: 'break' }, { text: 'b' }])
  })

  it('换行符切分保留样式（每段各自承继所在插值段的样式）', () => {
    const s = story('~ let t = "上\\n下"\n=== A ===\n<b>{t}</b>\n-> END')
    expect(spansOf(s)).toEqual([{ text: '上', bold: true }, { kind: 'break' }, { text: '下', bold: true }])
  })

  it('<pause> 落在换行符切出的 break 上（不被空段吞掉）', () => {
    const s = story('~ let t = "\\n后"\n=== A ===\n前<pause>{t}\n-> END')
    expect(spansOf(s)).toEqual([{ text: '前' }, { kind: 'break', pauseBefore: true }, { text: '后' }])
  })

  it('空插值仍不消费 <pause>（既有不变量）', () => {
    const s = story('~ let e = ""\n=== A ===\n前<pause>{e}后\n-> END')
    expect(spansOf(s)).toEqual([{ text: '前' }, { text: '后', pauseBefore: true }])
  })

  it('选项文本里的插值换行符同样生效', () => {
    const s = story('~ let t = "上\\n下"\n=== A ===\n* [{t}] -> END')
    drain(s)
    expect(s.currentChoices[0]!.spans).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })

  it('@panel 模板 literal 段里的字面换行符同样生效', () => {
    const s = story('=== A ===\n@panel("bottom", "上\\n下")\n文本\n-> END')
    const panels = drain(s).flatMap((e) => (e.kind === 'panel' ? [e.spans] : []))
    expect(panels[0]).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })
})
