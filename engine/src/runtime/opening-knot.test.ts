import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { storyFromEntry, drain } from './_test-helpers'
import { parse } from '../parser'
import { analyze, resolveStart } from '../analyze'
import { createStory } from './index'

const texts = (s: ReturnType<typeof storyFromEntry>) =>
  drain(s).flatMap((e) => (e.kind === 'text' ? [plainText(e.spans)] : []))

describe('runtime 开场 knot —— 全局作用域执行', () => {
  it('开场 knot 内 ~ let 落全局，后续显式 knot 可读', () => {
    const s = storyFromEntry('~ let gold = 10\n开场。\n-> A\n=== A ===\n你有{gold}金币。\n-> END')
    expect(texts(s)).toEqual(['开场。', '你有10金币。'])
  })
  it('开场 knot 内命令式 ~ 按源码顺序改全局，前后文本看到改值前/后', () => {
    const s = storyFromEntry('~ let gold = 10\n你有{gold}金币。\n~ gold -= 5\n还剩{gold}金币。')
    expect(texts(s)).toEqual(['你有10金币。', '还剩5金币。'])
  })
})

describe('runtime 开场 knot —— buildGlobals 不重复执行入口 preamble', () => {
  it('入口开场 knot 的命令式 ~ 只执行一次（跨文件 push 不重复）', () => {
    const a = parse('~ let log = []', 'a.kin') // 非入口：声明全局数组 log
    const main = parse("~ log.push('x')\n条目数{log.length}\n-> END", 'main.kin') // 入口开场：push 一次
    const program = analyze([a, main]).program!
    const start = resolveStart(program, 'main.kin')!
    const s = createStory(program, { start })
    const out: string[] = []
    while (s.canContinue) {
      const e = s.continue()
      if (e.kind === 'text') out.push(plainText(e.spans))
    }
    expect(out).toEqual(['条目数1']) // push 只发生一次；若 buildGlobals 预跑入口 preamble 则为 2
  })
})

describe('runtime 开场 knot —— 端到端', () => {
  it('纯文本零-knot 故事：逐行输出后触底 END', () => {
    const s = storyFromEntry('第一行。\n第二行。\n第三行。')
    expect(texts(s)).toEqual(['第一行。', '第二行。', '第三行。'])
    expect(s.hasEnded).toBe(true)
  })
  it('引子正文 + 显式跳转接续具名场景', () => {
    const s = storyFromEntry('雾涌上来。\n-> 港口\n=== 港口 ===\n你站在码头。\n-> END')
    expect(texts(s)).toEqual(['雾涌上来。', '你站在码头。'])
    expect(s.hasEnded).toBe(true)
  })
  it('开场含选项：开场就是可交互场景', () => {
    const src = ['选择：', '* [左] -> L', '* [右] -> R', '=== L ===', '左。', '-> END', '=== R ===', '右。', '-> END'].join('\n')
    const s = storyFromEntry(src)
    const out: string[] = []
    while (s.canContinue) {
      const e = s.continue()
      if (e.kind === 'text') out.push(plainText(e.spans))
    }
    expect(out).toEqual(['选择：'])
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['左', '右'])
    s.choose(0)
    while (s.canContinue) {
      const e = s.continue()
      if (e.kind === 'text') out.push(plainText(e.spans))
    }
    expect(out).toContain('左。')
  })
})
