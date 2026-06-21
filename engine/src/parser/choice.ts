import { findInterpEnd } from './interp'
import { splitInlineDivert } from './inline'
import { ParseError } from './errors'

export interface ParsedChoice {
  condition: string | null
  label: string | null
  before: string
  inner: string | null
  after: string
  divert: string | null
  fallback: boolean
}

/** 找 s 中从 from 起第一个未转义、且不在 `{}` 插值内的 target 字符；无则 -1。 */
function indexOfUnescaped(s: string, target: string, from: number): number {
  const n = s.length
  let i = from
  while (i < n) {
    const c = s[i]!
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') {
      const end = findInterpEnd(s, i)
      i = end === -1 ? n : end
      continue
    }
    if (c === target) return i
    i += 1
  }
  return -1
}

/**
 * 解析选项原串（`*`/`+` 之后整段）。文本区 before/inner/after 为去首尾空白的原始串，
 * divert 为 `'-> …'|null`，条件/标签为字符串。插值与转义留给增量③ 的 scanInline。
 */
export function parseChoice(raw: string, line: number, path: string): ParsedChoice {
  let s = raw.trim()
  let condition: string | null = null
  let label: string | null = null

  for (;;) {
    if (s.startsWith('{')) {
      if (condition !== null) {
        throw new ParseError('选项条件 {} 出现多次', line, path)
      }
      const end = findInterpEnd(s, 0)
      if (end === -1) {
        throw new ParseError('选项条件 { 未闭合', line, path)
      }
      condition = s.slice(1, end - 1).trim()
      s = s.slice(end).trimStart()
      continue
    }
    if (s.startsWith('(')) {
      if (label !== null) {
        throw new ParseError('选项标签 () 出现多次', line, path)
      }
      const close = s.indexOf(')')
      if (close === -1) {
        throw new ParseError('选项标签 ( 未闭合', line, path)
      }
      label = s.slice(1, close).trim()
      s = s.slice(close + 1).trimStart()
      continue
    }
    break
  }

  let before: string
  let inner: string | null
  let after: string
  let divert: string | null

  const lb = indexOfUnescaped(s, '[', 0)
  if (lb === -1) {
    const split = splitInlineDivert(s)
    before = split.text.trim()
    inner = null
    after = ''
    divert = split.divert
  } else {
    const rb = indexOfUnescaped(s, ']', lb + 1)
    if (rb === -1) {
      throw new ParseError('选项 [ 未闭合', line, path)
    }
    before = s.slice(0, lb).trim()
    inner = s.slice(lb + 1, rb).trim()
    const split = splitInlineDivert(s.slice(rb + 1))
    after = split.text.trim()
    divert = split.divert
  }

  const fallback =
    condition === null &&
    label === null &&
    inner === null &&
    before === '' &&
    after === '' &&
    divert !== null

  return { condition, label, before, inner, after, divert, fallback }
}
