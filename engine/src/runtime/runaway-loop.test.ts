import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory } from './index'
import { RuntimeError } from './types'
import type { Story } from './story'

// 漏标记致无停顿环：点过一次性「向左走」后，开场只剩正文「[向右走]」+ 无条件 -> 右，
// 形成 开场→右→开场 的吐文本环。
const RUNAWAY = [
  '=== 开场 ===',
  '你站在码头边，雾气漫过脚踝。',
  '* [向左走] -> 左',
  '[向右走] -> 右',
  '=== 左 ===',
  '左边是一排吊脚楼。',
  '-> 开场',
  '=== 右 ===',
  '右边泊着一条旧船。',
  '-> 开场',
].join('\n')

// 合法 sticky 回环：每轮停在选项等输入，choose 清零计数器，绝不应误报。
const STICKY = ['=== 开场 ===', '看四周。', '+ [再看一次] -> 开场'].join('\n')

// 长线性：纯 divert 链到 END，无任何选项，应正常跑完。
const LINEAR = [
  '=== a ===', '一段。', '-> b',
  '=== b ===', '两段。', '-> c',
  '=== c ===', '三段。', '-> END',
].join('\n')

/** 自动推进 + 按序选择，直到结束 / 无可用选择。会把引擎抛的错原样冒泡。 */
function drive(story: Story, choices: number[]): void {
  let ci = 0
  for (;;) {
    while (story.canContinue) story.continue()
    if (story.currentChoices.length > 0 && ci < choices.length) story.choose(choices[ci++]!)
    else return
  }
}

function build(src: string): Story {
  const program = analyze([parse(src, 'main.kin')]).program!
  return createStory(program, { start: src.includes('=== a ===') ? 'a' : '开场' })
}

describe('运行时死循环兜底', () => {
  it('无停顿自动跳转环抛 RuntimeError 并点名节点', () => {
    expect(() => drive(build(RUNAWAY), [0])).toThrow(/疑似死循环.*节点「[左右开场]+」/)
  })

  it('合法 sticky 回环不误报（choose 清零计数器）', () => {
    expect(() => drive(build(STICKY), Array(200).fill(0))).not.toThrow()
  })

  it('长线性故事正常跑到 END 不误报', () => {
    const s = build(LINEAR)
    expect(() => drive(s, [])).not.toThrow()
    expect(s.hasEnded).toBe(true)
  })
})
