import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory, restoreStory } from './index'
import type { Story } from './story'
import { RuntimeError } from './types'
import { plainText } from './spans'

function prog(src: string) {
  const p = analyze([parse(src, 'main.kin')]).program
  if (!p) throw new Error('analyze 有 error，fixture 不合法')
  return p
}

function make(src: string, start = 'A') {
  return createStory(prog(src), { start })
}

/** 推进（不提交）到暂停点，收集途中文本。 */
function drainText(s: Story): string[] {
  const out: string[] = []
  while (s.canContinue) {
    const e = s.continue()
    if (e.kind === 'text') out.push(plainText(e.spans))
  }
  return out
}

const GREET = [
  '~ let player_name = "旅人"',
  '=== A ===',
  '@input(player_name, "请输入你的名字")',
  '你好，{player_name}。',
  '-> END',
].join('\n')

describe('runtime @input —— 输入暂停态', () => {
  it('推进到 @input：canContinue===false、currentInput 返回 varName + placeholder', () => {
    const s = make(GREET)
    expect(drainText(s)).toEqual([]) // @input 前无文本，直接停在输入框
    expect(s.canContinue).toBe(false)
    expect(s.currentInput).toEqual({ varName: 'player_name', placeholder: '请输入你的名字' })
    expect(s.currentChoices).toEqual([]) // 与选项互斥
  })

  it('省略提示：placeholder 为 null', () => {
    const s = make(['~ let x = "d"', '=== A ===', '@input(x)', '{x}', '-> END'].join('\n'))
    drainText(s)
    expect(s.currentInput).toEqual({ varName: 'x', placeholder: null })
  })

  it('submitInput("Bob")：变量写回、恢复推进、后续插值显示所填', () => {
    const s = make(GREET)
    drainText(s)
    s.submitInput('Bob')
    expect(s.currentInput).toBeNull()
    expect(drainText(s)).toEqual(['你好，Bob。'])
  })

  it('submitInput 前后 turns +1（记一次玩家交互）', () => {
    const src = ['~ let x = "d"', '=== A ===', '前{turns()}', '@input(x)', '后{turns()}', '-> END'].join('\n')
    const s = make(src)
    expect(drainText(s)).toEqual(['前0'])
    s.submitInput('v')
    expect(drainText(s)).toEqual(['后1'])
  })

  it('submitInput 首尾空白被 trim', () => {
    const s = make(GREET)
    drainText(s)
    s.submitInput('  Bob  ')
    expect(drainText(s)).toEqual(['你好，Bob。'])
  })

  it('空提交：不覆写，保留变量声明值（默认名）', () => {
    const s = make(GREET)
    drainText(s)
    s.submitInput('')
    expect(drainText(s)).toEqual(['你好，旅人。'])
  })

  it('纯空白提交：同空提交，保留默认值', () => {
    const s = make(GREET)
    drainText(s)
    s.submitInput('   ')
    expect(drainText(s)).toEqual(['你好，旅人。'])
  })

  it('回写落到局部作用域（knot 内 let 声明的变量）', () => {
    const src = ['=== A ===', '~ let localname = "def"', '@input(localname)', '名字：{localname}', '-> END'].join('\n')
    const s = make(src)
    drainText(s)
    s.submitInput('Zoe')
    expect(drainText(s)).toEqual(['名字：Zoe'])
  })

  it('回写落到全局作用域（preamble 声明的变量，从 knot 内提交）', () => {
    const s = make(GREET)
    drainText(s)
    s.submitInput('Cara')
    expect(drainText(s)).toEqual(['你好，Cara。'])
  })

  it('无 pendingInput 时 submitInput 抛 RuntimeError', () => {
    const s = make(['=== A ===', '正文', '-> END'].join('\n'))
    expect(() => s.submitInput('x')).toThrow(RuntimeError)
    expect(() => s.submitInput('x')).toThrow('当前无待填输入框')
  })

  it('@input 前的文本先 flush（命令硬边界）', () => {
    const src = ['~ let x = "d"', '=== A ===', '开场白。', '@input(x)', '{x}', '-> END'].join('\n')
    const s = make(src)
    expect(drainText(s)).toEqual(['开场白。']) // 停在输入框前，先吐出前置文本
    expect(s.currentInput).toEqual({ varName: 'x', placeholder: null })
    s.submitInput('Y')
    expect(drainText(s)).toEqual(['Y'])
  })

  it('placeholder 支持动态表达式（当前作用域求值）', () => {
    const src = ['~ let x = ""', '~ let hint = "动态提示"', '=== A ===', '@input(x, hint)', '-> END'].join('\n')
    const s = make(src)
    drainText(s)
    expect(s.currentInput).toEqual({ varName: 'x', placeholder: '动态提示' })
  })

  it('连续两个 @input：顺序暂停、各自独立提交', () => {
    const src = [
      '~ let a = "da"',
      '~ let b = "db"',
      '=== A ===',
      '@input(a)',
      '@input(b)',
      '{a}/{b}',
      '-> END',
    ].join('\n')
    const s = make(src)
    drainText(s)
    expect(s.currentInput!.varName).toBe('a')
    s.submitInput('X')
    drainText(s)
    expect(s.currentInput!.varName).toBe('b')
    s.submitInput('Y')
    expect(drainText(s)).toEqual(['X/Y'])
  })

  it('提交后紧跟结束：回写完成后照常推进到 END', () => {
    const src = ['~ let x = "d"', '=== A ===', '@input(x)', '-> END'].join('\n')
    const s = make(src)
    drainText(s)
    s.submitInput('Z')
    expect(s.canContinue).toBe(false)
    expect(s.hasEnded).toBe(true)
  })

  it('快照：停在 @input 时 serialize → restore 重现同一 currentInput，续玩结果一致', () => {
    const program = prog(GREET)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.currentInput).toEqual({ varName: 'player_name', placeholder: '请输入你的名字' })

    const snap = JSON.parse(JSON.stringify(s.serialize())) // 落盘往返
    const r = restoreStory(program, snap)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s2 = r.story
    expect(s2.canContinue).toBe(false)
    expect(s2.currentInput).toEqual({ varName: 'player_name', placeholder: '请输入你的名字' })

    s.submitInput('Bob')
    s2.submitInput('Bob')
    expect(drainText(s2)).toEqual(drainText(s))
  })
})
