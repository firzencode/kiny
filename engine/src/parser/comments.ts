import { ParseError } from './errors'
import { normalizeNewlines } from './source'
import { splitLevel } from './levels'
import { findInterpEnd } from './interp'

interface ScanState {
  inFence: boolean
  inBlock: boolean
  blockStartLine: number
}

const AT_KEYWORDS = new Set(['if', 'elif', 'else'])


/**
 * 从 start 起按叙事文本扫描一行，剥离注释，返回处理后的该段。
 * 可能开启跨行块注释（写入 state）。
 */
function scanNarrative(line: string, start: number, lineNumber: number, state: ScanState): string {
  const n = line.length
  let out = ''
  let i = start
  while (i < n) {
    const c = line[i]!
    const c2 = i + 1 < n ? line[i + 1]! : ''
    if (c === '\\') {
      out += c
      if (i + 1 < n) out += line[i + 1]!
      i += 2
      continue
    }
    if (c === '{') {
      const end = findInterpEnd(line, i)
      const stop = end === -1 ? line.length : end
      out += line.slice(i, stop)
      i = stop
      continue
    }
    if (c === '-' && c2 === '>') {
      out += line.slice(i)
      break
    }
    if (c === '/' && c2 === '/') {
      out += ' '.repeat(n - i)
      break
    }
    if (c === '/' && c2 === '*') {
      const k = line.indexOf('*/', i + 2)
      if (k === -1) {
        out += ' '.repeat(n - i)
        state.inBlock = true
        state.blockStartLine = lineNumber
        break
      }
      out += ' '.repeat(k + 2 - i)
      i = k + 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

function processLine(line: string, lineNumber: number, state: ScanState): string {
  if (state.inFence) {
    if (line.trim() === '~~~') state.inFence = false
    return line
  }
  if (state.inBlock) {
    const k = line.indexOf('*/')
    if (k === -1) return ' '.repeat(line.length)
    state.inBlock = false
    return ' '.repeat(k + 2) + scanNarrative(line, k + 2, lineNumber, state)
  }
  if (line.trim() === '~~~') {
    state.inFence = true
    return line
  }
  const content = splitLevel(line).content
  if (content.startsWith('~')) return line
  const at = /^@([A-Za-z_][A-Za-z0-9_]*)/.exec(content)
  if (at && !AT_KEYWORDS.has(at[1]!)) return line
  return scanNarrative(line, 0, lineNumber, state)
}

/**
 * pass 0 · 注释预趟：剥离 Kiny 注释（`//` 与块注释），保留行数与行号
 * （注释处替换为空格、换行保留）。JS 区域一律豁免：`{}` 插值、`~` 行、
 * `~~~` 块、命令行 `@名字(...)`（但 `@if`/`@elif`/`@else` 不算命令、要扫描）、行末内联 `->`
 * （见 docs/reference/engine-parser-spec.md §2）。
 * 块注释未闭合 → ParseError（行号指向块注释起始行）。
 */
export function stripComments(text: string, path: string): string {
  const state: ScanState = { inFence: false, inBlock: false, blockStartLine: 0 }
  const lines = normalizeNewlines(text).split('\n')
  const out = lines.map((line, idx) => processLine(line, idx + 1, state))
  if (state.inBlock) {
    throw new ParseError('块注释 /* 未闭合', state.blockStartLine, path)
  }
  return out.join('\n')
}
