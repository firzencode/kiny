import { describe, it, expect } from 'vitest'
import { StringStream } from '@codemirror/language'
import { kinStreamParser } from './kinLanguage'
import { clsToToken } from './highlight'
import { tokenizeLine } from '../syntax/kin'

/** 用 StreamParser 把单行切成 {text, token} 序列（模拟 CM6 逐 token 调 token()）。 */
function streamTokens(line: string): { text: string; token: string | null }[] {
  const out: { text: string; token: string | null }[] = []
  if (line.length === 0) return out
  const stream = new StringStream(line, 2, 2)
  const state = kinStreamParser.startState!(2)
  let guard = 0
  while (!stream.eol()) {
    if (guard++ > line.length + 5) throw new Error('stream 未推进，死循环：' + line)
    const start = stream.pos
    const token = kinStreamParser.token(stream, state)
    out.push({ text: line.slice(start, stream.pos), token: token ?? null })
  }
  return out
}

/** 代表性行：覆盖所有 token 类。 */
const LINES = [
  '=== 开场 ===',
  '= 小节',
  '* [选项标签] 这是选项 -> 下一节',
  '+ 粘性选项 {flag}',
  '~ let count = 0',
  '~~~',
  '> > 嵌套分支正文',
  '@bgm music.mp3',
  '普通正文 {name} 还有 -> 跳转',
  '加粗 <b>厚</b> 斜体 <i>斜</i> 颜色 <color=red>红</color> 换行<br>',
  '比较 1 < 2 不是标签',
  '"一段字符串" 和 turns_since(door)',
  '正文 // 行尾注释',
  '// 整行注释',
  '   缩进正文',
  '',
]

describe('kinStreamParser（CM6 StreamLanguage 适配器）', () => {
  it('每行 token 序列与 tokenizeLine 逐字段等价（t-text → null）', () => {
    for (const line of LINES) {
      const expected = tokenizeLine(line).map((t) => ({ text: t.text, token: clsToToken(t.cls) }))
      expect(streamTokens(line)).toEqual(expected)
    }
  })

  it('token 文本拼回原行一字不差（含裸 < 与中文）', () => {
    for (const line of LINES) {
      const joined = streamTokens(line).map((t) => t.text).join('')
      expect(joined).toBe(line)
    }
  })

  it('裸 < 不误判成富文本标签（1 < 2 落 null/正文）', () => {
    const toks = streamTokens('1 < 2')
    // 不应出现 t-tag token
    expect(toks.some((t) => t.token === 't-tag')).toBe(false)
    expect(toks.map((t) => t.text).join('')).toBe('1 < 2')
  })

  it('富文本标签识别为 t-tag', () => {
    const toks = streamTokens('文字<b>粗</b>')
    expect(toks.filter((t) => t.token === 't-tag').map((t) => t.text)).toEqual(['<b>', '</b>'])
  })

  it('节点头 === name === 三段：定界符 t-node-d、名 t-node', () => {
    const toks = streamTokens('=== 开场 ===')
    expect(toks.find((t) => t.token === 't-node')?.text).toBe('开场')
    expect(toks.filter((t) => t.token === 't-node-d').length).toBeGreaterThanOrEqual(2)
  })
})
