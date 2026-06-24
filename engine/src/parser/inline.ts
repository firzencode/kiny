import type { InlineSegment, InlineStyle, RichTextIssue } from './ast'
import { findInterpEnd } from './interp'
import { ParseError } from './errors'

export interface ScanResult {
  segments: InlineSegment[]
  glue: boolean
  nextId: number
  /** 本片段内的富文本问题（未闭合 / 错配 / 非法颜色 / 非法字号）；无则空数组。 */
  issues: RichTextIssue[]
}

/** 任意位置可转义为字面的单字符集合（AST 规范 §4）。`\>` 在此、`\->` 由下方单独处理。 */
const ESCAPABLE = new Set(['{', '}', '<', '/', '\\', '=', '*', '+', '>', '~', '@', '[', ']', '(', ')'])

/** 切换型样式标签（无取值，开/闭成对）→ InlineStyle 上的布尔键。 */
const FLAG_TAGS: Record<string, 'bold' | 'italic' | 'underline' | 'strike'> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strike',
}

/** 一个栈帧记录开标签名与（取值标签的）已校验值；非法值标签 value 为 null（结构成对但不应用样式）。 */
interface TagFrame {
  tag: string // 'b' | 'i' | 'u' | 's' | 'color' | 'size'
  color?: string | null
  size?: number | null
}

/** 颜色取值合法性：`#rgb` / `#rrggbb` / 纯字母具名色（防 style 注入：不接受空格 / 括号 / 分号等）。 */
function validColor(v: string): boolean {
  if (/^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v)) return true
  return /^[a-zA-Z]+$/.test(v)
}

/** 字号取值合法性：能解析为正有限数。 */
function parseSize(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 两个内联样式是否等价（用于归并标签边界处产生的相邻同样式 literal 段）。 */
function sameInlineStyle(a: InlineStyle | undefined, b: InlineStyle | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    a.color === b.color &&
    a.size === b.size
  )
}

/** 由当前标签栈算出活动样式快照；无任何样式时返回 undefined（段不带 style 字段）。 */
function activeStyle(stack: TagFrame[]): InlineStyle | undefined {
  const style: InlineStyle = {}
  let any = false
  for (const f of stack) {
    const flag = FLAG_TAGS[f.tag]
    if (flag) {
      style[flag] = true
      any = true
    } else if (f.tag === 'color' && f.color != null) {
      style.color = f.color // 内层覆盖外层
      any = true
    } else if (f.tag === 'size' && f.size != null) {
      style.size = f.size
      any = true
    }
  }
  return any ? style : undefined
}

/**
 * 在位置 i（text[i] === '<'）尝试匹配一个富文本标签。
 * 返回 { len } 表示消费的字符数，与解析出的标签信息；非合法标签返回 null（调用方按字面处理 `<`）。
 */
function matchTag(
  text: string,
  i: number,
): { len: number; kind: 'open'; tag: string; rawValue?: string } | { len: number; kind: 'close'; tag: string } | { len: number; kind: 'break' } | null {
  const close = text.indexOf('>', i + 1)
  if (close === -1) return null
  const inner = text.slice(i + 1, close)
  const len = close - i + 1
  if (inner === '') return null // `<>` 交给 glue 逻辑，不是标签
  if (inner === 'br' || inner === 'br/') return { len, kind: 'break' }
  if (inner[0] === '/') {
    const name = inner.slice(1)
    if (name === 'color' || name === 'size' || name in FLAG_TAGS) return { len, kind: 'close', tag: name }
    return null
  }
  if (inner in FLAG_TAGS) return { len, kind: 'open', tag: inner }
  const eq = inner.indexOf('=')
  if (eq !== -1) {
    const name = inner.slice(0, eq)
    if (name === 'color' || name === 'size') return { len, kind: 'open', tag: name, rawValue: inner.slice(eq + 1) }
  }
  return null
}

/**
 * 把文本片段扫成 InlineSegment[]：字面段（转义已还原）+ `{…}` 插值段（带 id）+ 富文本标签。
 * 富文本标签（`<b>`/`<i>`/`<u>`/`<s>`/`<color=…>`/`<size=…>`/`<br>`）经样式栈扁平化挂到各段 style 上；
 * 未闭合 / 错配 / 非法颜色或字号 → 收进 issues（运行期优雅降级：未闭合自动闭合到段末、非法值不应用）。
 * 行末未转义的 `<>` 置 glue（不进 segments）。`id` 从 startId 起、回传 nextId。
 * 未闭合的 `{` 抛 ParseError（用 line/path 定位）。不处理行末 `->` 拆分与选项 `[]()`。
 */
export function scanInline(text: string, startId: number, line: number, path: string): ScanResult {
  const segments: InlineSegment[] = []
  const issues: RichTextIssue[] = []
  const stack: TagFrame[] = []
  let glue = false
  let id = startId
  let literal = ''
  let i = 0
  const n = text.length

  const flush = (): void => {
    if (literal === '') return
    const style = activeStyle(stack)
    // 标签边界处样式未变时（错配 / 非法值忽略），与前一同样式 literal 归并，保持纯文本恒为单段。
    const prev = segments[segments.length - 1]
    if (prev && prev.kind === 'literal' && sameInlineStyle(prev.style, style)) {
      prev.value += literal
    } else {
      segments.push(style ? { kind: 'literal', value: literal, style } : { kind: 'literal', value: literal })
    }
    literal = ''
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
      const style = activeStyle(stack)
      const code = text.slice(i + 1, end - 1)
      segments.push(style ? { kind: 'interp', code, id, style } : { kind: 'interp', code, id })
      id += 1
      i = end
      continue
    }
    if (c === '<') {
      // 行末孤立 <> 仍是 glue（标签都有非空名，不与此冲突）。
      if (c2 === '>' && text.slice(i + 2).trim() === '') {
        glue = true
        break
      }
      const m = matchTag(text, i)
      if (m === null) {
        literal += c // 非合法标签：按字面处理裸 <
        i += 1
        continue
      }
      flush()
      if (m.kind === 'break') {
        segments.push({ kind: 'break' })
      } else if (m.kind === 'open') {
        if (m.tag === 'color') {
          const ok = validColor(m.rawValue!)
          if (!ok) issues.push({ code: 'rich-bad-color', message: `非法颜色值：「${m.rawValue}」`, line })
          stack.push({ tag: 'color', color: ok ? m.rawValue! : null })
        } else if (m.tag === 'size') {
          const sz = parseSize(m.rawValue!)
          if (sz === null) issues.push({ code: 'rich-bad-size', message: `非法字号倍数：「${m.rawValue}」`, line })
          stack.push({ tag: 'size', size: sz })
        } else {
          stack.push({ tag: m.tag })
        }
      } else {
        // 闭标签：从栈顶向下找最近的同名开标签，弹到它（含之间未闭合的）；找不到则记错配、忽略。
        let found = -1
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k]!.tag === m.tag) {
            found = k
            break
          }
        }
        if (found === -1) {
          issues.push({ code: 'rich-mismatch', message: `孤立的闭标签：「</${m.tag}>」`, line })
        } else {
          stack.length = found
        }
      }
      i += m.len
      continue
    }
    literal += c
    i += 1
  }
  flush()
  // 扫完仍有未闭合的开标签 → 运行期已自动闭合到段末（样式照常应用），此处记诊断。
  for (const f of stack) {
    issues.push({ code: 'rich-unclosed', message: `未闭合的标签：「<${f.tag}>」`, line })
  }
  return { segments, glue, nextId: id, issues }
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
