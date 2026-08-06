import { describe, it, expect } from 'vitest'
import { story, texts } from './_test-helpers'
import type { RichSpan } from './spans'

describe('runtime 3e —— 粘连', () => {
  it('<> 跨跳转把目标首段接上来', () => {
    const src = ['=== A ===', '我转身离开<>', '-> next', '=== next ===', '，头也不回。', '-> END'].join(
      '\n',
    )
    expect(texts(story(src))).toEqual(['我转身离开，头也不回。'])
  })
  it('行内 <> -> 同样合并', () => {
    const src = ['=== A ===', '甲<> -> B', '=== B ===', '乙', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['甲乙'])
  })
  it('无粘连各自成行', () => {
    expect(texts(story('=== A ===\n甲\n乙\n-> END'))).toEqual(['甲', '乙'])
  })

  it('glue 文本紧接 -> END 不丢失（末段仍 flush）', () => {
    const src = ['=== A ===', '我转身离开<>', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['我转身离开'])
  })
  it('行内 glue 紧接 -> END 不丢失', () => {
    const src = ['=== A ===', '甲<> -> END'].join('\n')
    expect(texts(story(src))).toEqual(['甲'])
  })
  it('glue 链一路到 END 仍 flush 成一行', () => {
    const src = ['=== A ===', '甲<>', '-> B', '=== B ===', '乙<>', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['甲乙'])
  })
})

/** drain 后取第一条 text 事件的 spans（断言 pauseBefore 位置用）。 */
function firstSpans(s: ReturnType<typeof story>): RichSpan[] {
  while (s.canContinue) {
    const e = s.continue()
    if (e.kind === 'text') return e.spans
  }
  throw new Error('无 text 事件')
}

describe('runtime —— <pause> 句中停顿标记', () => {
  it('整行仍是一个 text 事件，标记落在后半段的 span 上', () => {
    const spans = firstSpans(story('=== A ===\n凶手就是…<pause>你自己！\n-> END'))
    expect(spans).toEqual([
      { text: '凶手就是…' },
      { text: '你自己！', pauseBefore: true },
    ])
  })

  it('glue 跨行拼接：后半行行首的标记在拼接处保留', () => {
    const src = ['=== A ===', '我转身离开<>', '-> B', '=== B ===', '<pause>，头也不回。', '-> END'].join('\n')
    expect(firstSpans(story(src))).toEqual([
      { text: '我转身离开' },
      { text: '，头也不回。', pauseBefore: true },
    ])
  })

  it('标记后紧跟空插值：标记顺延到下一个有内容的段，不凭空消失', () => {
    const src = ['~ let empty = ""', '=== A ===', '前<pause>{empty}后', '-> END'].join('\n')
    expect(firstSpans(story(src))).toEqual([
      { text: '前' },
      { text: '后', pauseBefore: true },
    ])
  })

  it('插值内容本身承载标记（相邻同样式不跨界归并）', () => {
    const src = ['~ let who = "你自己"', '=== A ===', '凶手就是…<pause>{who}！', '-> END'].join('\n')
    expect(firstSpans(story(src))).toEqual([
      { text: '凶手就是…' },
      { text: '你自己！', pauseBefore: true },
    ])
  })

  it('毫秒档：档值随 span 流出，不被压成点击档', () => {
    const spans = firstSpans(story('=== A ===\n门开了一条缝<pause=2000>，什么都没有。\n-> END'))
    expect(spans).toEqual([
      { text: '门开了一条缝' },
      { text: '，什么都没有。', pauseBefore: 2000 },
    ])
  })

  it('毫秒档 glue 跨行拼接：拼接处档值原样保留', () => {
    const src = ['=== A ===', '我转身离开<>', '-> B', '=== B ===', '<pause=1500>，头也不回。', '-> END'].join('\n')
    expect(firstSpans(story(src))).toEqual([
      { text: '我转身离开' },
      { text: '，头也不回。', pauseBefore: 1500 },
    ])
  })

  it('毫秒档后紧跟空插值：档值随标记一起顺延', () => {
    const src = ['~ let empty = ""', '=== A ===', '前<pause=600>{empty}后', '-> END'].join('\n')
    expect(firstSpans(story(src))).toEqual([
      { text: '前' },
      { text: '后', pauseBefore: 600 },
    ])
  })

  it('同一行混用两档：各段各自保留自己的档位', () => {
    const spans = firstSpans(story('=== A ===\n前<pause>中<pause=500>后\n-> END'))
    expect(spans).toEqual([
      { text: '前' },
      { text: '中', pauseBefore: true },
      { text: '后', pauseBefore: 500 },
    ])
  })
})
