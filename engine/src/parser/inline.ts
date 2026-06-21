import type { InlineSegment } from './ast'
import { findInterpEnd } from './interp'
import { ParseError } from './errors'

export interface ScanResult {
  segments: InlineSegment[]
  glue: boolean
  nextId: number
}

/** 任意位置可转义为字面的单字符集合（AST 规范 §4）。`\>` 在此、`\->` 由下方单独处理。 */
const ESCAPABLE = new Set(['{', '}', '<', '/', '\\', '=', '*', '+', '>', '~', '@', '[', ']', '(', ')'])

/**
 * 把文本片段扫成 InlineSegment[]：字面段（转义已还原）+ `{…}` 插值段（带 id）。
 * 行末未转义的 `<>` 置 glue（不进 segments）。`id` 从 startId 起、回传 nextId。
 * 未闭合的 `{` 抛 ParseError（用 line/path 定位）。不处理行末 `->` 拆分与选项 `[]()`。
 */
export function scanInline(text: string, startId: number, line: number, path: string): ScanResult {
  const segments: InlineSegment[] = []
  let glue = false
  let id = startId
  let literal = ''
  let i = 0
  const n = text.length

  const flush = (): void => {
    if (literal !== '') {
      segments.push({ kind: 'literal', value: literal })
      literal = ''
    }
  }

  while (i < n) {
    const c = text[i]!
    const c2 = i + 1 < n ? text[i + 1]! : ''
    if (c === '\\') {
      if (c2 === '-' && i + 2 < n && text[i + 2] === '>') {
        literal += '->'
        i += 3
        continue
      }
      if (c2 !== '' && ESCAPABLE.has(c2)) {
        literal += c2
        i += 2
        continue
      }
      literal += '\\'
      i += 1
      continue
    }
    if (c === '{') {
      const end = findInterpEnd(text, i)
      if (end === -1) {
        throw new ParseError('插值 { 未闭合', line, path)
      }
      flush()
      segments.push({ kind: 'interp', code: text.slice(i + 1, end - 1), id })
      id += 1
      i = end
      continue
    }
    if (c === '<' && c2 === '>' && text.slice(i + 2).trim() === '') {
      glue = true
      break
    }
    literal += c
    i += 1
  }
  flush()
  return { segments, glue, nextId: id }
}

/**
 * 找文本片段中第一个未转义、且不在 `{}` 插值内的 `->`，切成左半文本与 `'-> …'`。
 * 无则 divert 为 null。供文本行与选项后段共用。
 */
export function splitInlineDivert(text: string): { text: string; divert: string | null } {
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]!
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') {
      const end = findInterpEnd(text, i)
      i = end === -1 ? n : end
      continue
    }
    if (c === '-' && text[i + 1] === '>') {
      return { text: text.slice(0, i), divert: text.slice(i) }
    }
    i += 1
  }
  return { text, divert: null }
}
