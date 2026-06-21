import { describe, it, expect } from 'vitest'
import { story, texts } from './_test-helpers'

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
