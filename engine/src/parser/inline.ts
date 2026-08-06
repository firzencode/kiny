import type { InlineSegment, InlineStyle, PauseKind, RichTextIssue } from './ast'
import { findInterpEnd } from './interp'
import { sameStyle } from './style'
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

/** 取值型样式标签（`<名=值>` 开、`</名>` 闭）。 */
const VALUE_TAGS = new Set(['color', 'size', 'font', 'class'])

/** 一个栈帧记录开标签名与（取值标签的）已校验值；非法值标签 value 为 null（结构成对但不应用样式）。 */
interface TagFrame {
  tag: string // 'b' | 'i' | 'u' | 's' | 'color' | 'size' | 'font' | 'class'
  color?: string | null
  size?: number | null
  font?: string | null
  cls?: string | null
}

/** 颜色取值合法性：`#rgb` / `#rrggbb` / 纯字母具名色（防 style 注入：不接受空格 / 括号 / 分号等）。 */
function validColor(v: string): boolean {
  if (/^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v)) return true
  return /^[a-zA-Z]+$/.test(v)
}

/**
 * 字体族名合法性（防 font-family 注入 / 越界）：trim 后非空，且只含 Unicode 字母（含 CJK）、数字、
 * 空格、点 `.`、下划线 `_`、连字符 `-`。拒绝 `; { } ( ) < > " '` / 逗号 / 反斜杠 / 控制字符等。
 * 单个族名不含逗号（回退栈由宿主拼）；项目内字体文件的族名（= 文件名去扩展名）按同规则校验。
 */
export function validFont(v: string): boolean {
  const s = v.trim()
  return s !== '' && /^[\p{L}\p{N} ._-]+$/u.test(s)
}

/**
 * 样式类名合法性：trim 后非空，只含 Unicode 字母（含 CJK）、数字、下划线 `_`、连字符 `-`。
 * 比字体名更严（不含空格与点）——渲染时拼进 class 属性，空格会拆成多类、点是选择器边界字符。
 */
export function validClass(v: string): boolean {
  const s = v.trim()
  return s !== '' && /^[\p{L}\p{N}_-]+$/u.test(s)
}

/** 字号取值合法性：能解析为正有限数。 */
function parseSize(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * `<pause=毫秒>` 取值上限：`setTimeout` 的延时被钳成有符号 32 位整数，超出会溢出成「立刻触发」。
 * 与其让超大值静默变成「根本不停顿」，不如在校验期就报错——作者在 editor 里看得见红线。
 */
const MAX_PAUSE_MS = 2_147_483_647

/**
 * `<pause=毫秒>` 取值合法性：**正整数**毫秒，上限 `MAX_PAUSE_MS`（约 24.8 天，够任何演出用）。
 * 拒绝 0 / 负数 / 小数 / 非数字 / 空值——正则先卡住形态，避免 `Number(' 5 ')`、`Number('1e3')` 之类的宽松解析。
 */
function parsePauseMs(v: string): number | null {
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_PAUSE_MS ? n : null
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
    } else if (f.tag === 'font' && f.font != null) {
      style.font = f.font // 内层覆盖外层（同 color / size）
      any = true
    } else if (f.tag === 'class' && f.cls != null) {
      // class 与取值标签不同：嵌套**累积**（外层 letter + 内层 old 同时生效），同名去重。
      if (!style.classes) style.classes = []
      if (!style.classes.includes(f.cls)) style.classes.push(f.cls)
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
):
  | { len: number; kind: 'open'; tag: string; rawValue?: string }
  | { len: number; kind: 'close'; tag: string }
  | { len: number; kind: 'break' }
  | { len: number; kind: 'pause'; value: PauseKind }
  | { len: number; kind: 'bad-pause'; rawValue: string }
  | null {
  const close = text.indexOf('>', i + 1)
  if (close === -1) return null
  const inner = text.slice(i + 1, close)
  const len = close - i + 1
  if (inner === '') return null // `<>` 交给 glue 逻辑，不是标签
  if (inner === 'br' || inner === 'br/') return { len, kind: 'break' }
  if (inner === 'pause' || inner === 'pause/') return { len, kind: 'pause', value: true } // 点击档；自闭合写法与 <br/> 一致
  if (inner.startsWith('pause=')) {
    // 毫秒档 `<pause=毫秒>`；尾随斜杠 `<pause=500/>` 等价（与 `<pause/>` / `<br/>` 对称）。
    const raw = inner.slice('pause='.length)
    const ms = parsePauseMs(raw.endsWith('/') ? raw.slice(0, -1) : raw)
    // 报错时回显**作者原样写的**取值（含尾随斜杠），否则消息与源码对不上。
    return ms === null ? { len, kind: 'bad-pause', rawValue: raw } : { len, kind: 'pause', value: ms }
  }
  if (inner[0] === '/') {
    const name = inner.slice(1)
    if (VALUE_TAGS.has(name) || name in FLAG_TAGS) return { len, kind: 'close', tag: name }
    return null
  }
  if (inner in FLAG_TAGS) return { len, kind: 'open', tag: inner }
  const eq = inner.indexOf('=')
  if (eq !== -1) {
    const name = inner.slice(0, eq)
    if (VALUE_TAGS.has(name)) return { len, kind: 'open', tag: name, rawValue: inner.slice(eq + 1) }
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

  // `<pause>` 停顿标记：作用于其**后首个非空段**（空插值 / 空字面段不消费它，自动顺延）。
  // 扫完仍挂着 = 行尾标记，直接忽略（行尾本就是行边界）。连续多个标记合并为一次停顿，
  // 档位取**最后一个**（后写的覆盖先写的，与「一处停顿」的直觉一致）。
  let pausePending: PauseKind | null = null
  /** 把待挂的停顿标记打到刚产出的段上（并清标志）。 */
  const takePause = <T extends InlineSegment>(seg: T): T => {
    if (pausePending !== null) {
      seg.pauseBefore = pausePending
      pausePending = null
    }
    return seg
  }

  const flush = (): void => {
    if (literal === '') return
    const style = activeStyle(stack)
    // 标签边界处样式未变时（错配 / 非法值忽略），与前一同样式 literal 归并，保持纯文本恒为单段。
    // 但**不得跨停顿标记归并**——标记强制在此断开段。
    const prev = segments[segments.length - 1]
    if (pausePending === null && prev && prev.kind === 'literal' && sameStyle(prev.style, style)) {
      prev.value += literal
    } else {
      segments.push(takePause(style ? { kind: 'literal', value: literal, style } : { kind: 'literal', value: literal }))
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
      segments.push(takePause(style ? { kind: 'interp', code, id, style } : { kind: 'interp', code, id }))
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
        segments.push(takePause({ kind: 'break' }))
      } else if (m.kind === 'pause') {
        pausePending = m.value // 作用于后续首个非空段；行尾则自然作废。相邻标记后者覆盖前者
      } else if (m.kind === 'bad-pause') {
        // 非法标记不产生边界，且**作废前一个待挂标记**——`<pause><pause=abc>` 与
        // 「档位取最后一个」一致地以最后一个为准，只不过最后一个是废的。
        pausePending = null
        issues.push({
          code: 'rich-bad-pause',
          message: `非法停顿时长：「${m.rawValue}」（<pause=毫秒> 只接受正整数毫秒）`,
          line,
        })
      } else if (m.kind === 'open') {
        if (m.tag === 'color') {
          const ok = validColor(m.rawValue!)
          if (!ok) issues.push({ code: 'rich-bad-color', message: `非法颜色值：「${m.rawValue}」`, line })
          stack.push({ tag: 'color', color: ok ? m.rawValue! : null })
        } else if (m.tag === 'size') {
          const sz = parseSize(m.rawValue!)
          if (sz === null) issues.push({ code: 'rich-bad-size', message: `非法字号倍数：「${m.rawValue}」`, line })
          stack.push({ tag: 'size', size: sz })
        } else if (m.tag === 'font') {
          const font = m.rawValue!.trim()
          const ok = validFont(font)
          if (!ok) issues.push({ code: 'rich-bad-font', message: `非法字体名：「${m.rawValue}」`, line })
          stack.push({ tag: 'font', font: ok ? font : null })
        } else if (m.tag === 'class') {
          const cls = m.rawValue!.trim()
          const ok = validClass(cls)
          if (!ok) issues.push({ code: 'rich-bad-class', message: `非法类名：「${m.rawValue}」`, line })
          stack.push({ tag: 'class', cls: ok ? cls : null })
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
