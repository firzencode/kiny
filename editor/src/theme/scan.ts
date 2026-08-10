/**
 * 主题 css 的最小扫描器 + 定点替换。
 *
 * GUI 绝不由自身状态重新生成整个文件——那会抹掉作者的注释与排版。做法是记下每个
 * `--kiny-*` 声明**值在文本中的区间**，改动时只替换那一段字符，其余逐字保留。
 *
 * 不需要完整 CSS 解析器：只要能跳过注释与字符串、认出顶层 `.player` 规则块、并在块内
 * 找出 `--kiny-<名>: <值>;` 的值区间即可。**解析不了就明说失败**，由 GUI 放弃编辑、
 * 提示切「原文」——绝不猜着写回，那会写坏作者的文件。
 */

/** 一条被 GUI 认识的 token 声明。`valueStart`/`valueEnd` 是值在原文中的半开区间。 */
export interface ThemeToken {
  name: string
  value: string
  valueStart: number
  valueEnd: number
}

export type ScanResult =
  | {
      ok: true
      tokens: ThemeToken[]
      uncoveredCount: number
      /**
       * 写在 `.player` 块**之外**的换肤变量声明数（`html .player`、`:root`、`@media` 里的等）。
       * 它们不归 GUI 管，且可能因特异性 / 层叠盖过 GUI 的写回——须明示，否则作者会看见
       * 「拖了滑杆却没变化」而无从解释。
       */
      foreignTokenCount: number
    }
  | { ok: false; reason: string }

/** GUI 只认这个前缀的自定义属性（播放层的公开换肤契约）。 */
const TOKEN_PREFIX = '--kiny-'

/**
 * 是否 `.player` 规则块的选择器。逗号组里含 `.player` 即算（该组对阅读区生效）；
 * 后代 / 复合选择器（`.player .foo`、`html .player`、`.player:not(x)`）不是 token 容器。
 * 先剥注释——`.player /* 主题 *​/ {` 是很自然的写法，不该因此认不出来。
 */
function isPlayerSelector(sel: string): boolean {
  return sel
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .some((part) => part.trim() === '.player')
}

/**
 * 从 pos 起跳过注释与空白，返回新位置；注释未闭合返回 -1。
 * 字符串不在此处跳——顶层只可能在选择器里出现引号，交给声明/选择器扫描各自处理。
 */
function skipTrivia(text: string, pos: number): number {
  for (;;) {
    while (pos < text.length && /\s/.test(text[pos])) pos++
    if (text.startsWith('/*', pos)) {
      const end = text.indexOf('*/', pos + 2)
      if (end === -1) return -1
      pos = end + 2
      continue
    }
    return pos
  }
}

/** 从 pos 起找下一个「不在注释 / 字符串里」的目标字符之一；返回其下标，找不到 -1，注释/字符串未闭合 -2。 */
function findTop(text: string, pos: number, targets: string): number {
  while (pos < text.length) {
    const c = text[pos]
    if (c === '/' && text[pos + 1] === '*') {
      const end = text.indexOf('*/', pos + 2)
      if (end === -1) return -2
      pos = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      const end = endOfString(text, pos)
      if (end === -1) return -2
      pos = end
      continue
    }
    if (targets.includes(c)) return pos
    pos++
  }
  return -1
}

/** 字符串字面量的结束位置（引号之后一位）；未闭合返回 -1。 */
function endOfString(text: string, pos: number): number {
  const quote = text[pos]
  let i = pos + 1
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] === quote) return i + 1
    if (text[i] === '\n') return -1 // css 字符串不跨行
    i++
  }
  return -1
}

/**
 * 值区间的收尾：返回「最后一个既非空白、也不在注释里的字符」之后一位。
 * **向前扫**而非从尾部回退——回退要靠 `lastIndexOf('/*')` 找注释开头，遇到
 * `#111 /* a /* b *​/` 会找到内层那个 `/*`、把作者注释里的字吞进值区间，
 * 一次写回就把它删了（正是本机制承诺绝不发生的事）。
 */
function trimValueEnd(text: string, start: number, end: number): number {
  let pos = start
  let last = start
  while (pos < end) {
    if (text.startsWith('/*', pos)) {
      const close = text.indexOf('*/', pos + 2)
      if (close === -1 || close + 2 > end) return last
      pos = close + 2
      continue
    }
    const c = text[pos]
    if (c === '"' || c === "'") {
      const strEnd = endOfString(text, pos)
      if (strEnd === -1 || strEnd > end) return last
      pos = strEnd
      last = strEnd
      continue
    }
    pos++
    if (!/\s/.test(c)) last = pos
  }
  return last
}

/** 数一段文本里的换肤变量声明（先剥注释）：给「写在别处、可能盖过 GUI」的那些计数。 */
function countTokenDecls(text: string): number {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return (stripped.match(/--kiny-[\w-]+\s*:/g) ?? []).length
}

/**
 * 扫描主题 css。成功时给出 GUI 认识的 token（同名取**最后一条**，与层叠结果一致）
 * 与「GUI 未覆盖内容」的处数（顶层非 `.player` 规则块、`.player` 内的非 token 声明各算一处）。
 */
export function scanThemeCss(text: string): ScanResult {
  const byName = new Map<string, ThemeToken>()
  let uncovered = 0
  let foreign = 0
  let pos = 0

  for (;;) {
    pos = skipTrivia(text, pos)
    if (pos === -1) return { ok: false, reason: '注释未闭合' }
    if (pos >= text.length) break

    // at-rule 无块体的形式（@import "x";）——整条跳过，算一处未覆盖
    const open = findTop(text, pos, '{};')
    if (open === -2) return { ok: false, reason: '注释或字符串未闭合' }
    if (open === -1) return { ok: false, reason: '规则块不完整' }
    if (text[open] === '}') return { ok: false, reason: '多余的 }' }
    if (text[open] === ';') { uncovered++; pos = open + 1; continue }

    const selector = text.slice(pos, open)
    const body = findBlockEnd(text, open)
    if (body === -1) return { ok: false, reason: '规则块未闭合' }

    if (isPlayerSelector(selector)) {
      const inner = scanDeclarations(text, open + 1, body)
      if (!inner) return { ok: false, reason: '声明块解析失败' }
      for (const t of inner.tokens) byName.set(t.name, t) // 后者覆盖前者
      uncovered += inner.uncovered
    } else {
      uncovered++
      foreign += countTokenDecls(text.slice(open + 1, body))
    }
    pos = body + 1
  }

  // 按值区间先后排序，令 GUI 呈现顺序与文件顺序一致
  const tokens = [...byName.values()].sort((a, b) => a.valueStart - b.valueStart)
  return { ok: true, tokens, uncoveredCount: uncovered, foreignTokenCount: foreign }
}

/** 规则块的结束 `}` 下标（支持嵌套，如 `@media`）；未闭合返回 -1。 */
function findBlockEnd(text: string, openBrace: number): number {
  let depth = 0
  let pos = openBrace
  while (pos < text.length) {
    const at = findTop(text, pos, '{}')
    if (at < 0) return -1
    if (text[at] === '{') depth++
    else if (--depth === 0) return at
    pos = at + 1
  }
  return -1
}

/**
 * 扫一个声明块的内部（不含花括号）。解析不了返回 null。
 * `unterminatedAt`：末条声明**省了分号**时（本扫描器接受这种写法），该补分号的位置；
 * 否则 null。追加新声明前必须据此补上——不补就会把追加行吞进上一条的值里，
 * 上一条的行内注释被删、被追加的那条从此不存在。
 */
function scanDeclarations(
  text: string, from: number, to: number,
): { tokens: ThemeToken[]; uncovered: number; unterminatedAt: number | null } | null {
  const tokens: ThemeToken[] = []
  let uncovered = 0
  let unterminatedAt: number | null = null
  let pos = from

  for (;;) {
    pos = skipTrivia(text, pos)
    if (pos === -1) return null
    if (pos >= to) break

    const stop = findTop(text, pos, ';{}')
    if (stop === -2) return null
    // 块内最后一条声明可省分号：以块尾为界
    const end = stop === -1 || stop > to ? to : stop
    if (text[end] === '{') return null // 嵌套规则：本扫描器不处理，交未覆盖计数之外的失败路径

    const unterminated = end >= to && text[end] !== ';'
    const colon = text.indexOf(':', pos)
    if (colon !== -1 && colon < end) {
      const name = text.slice(pos, colon).trim()
      const valueStart = skipTrivia(text, colon + 1)
      if (valueStart === -1) return null
      const valueEnd = trimValueEnd(text, valueStart, end)
      if (name.startsWith(TOKEN_PREFIX)) {
        tokens.push({ name, value: text.slice(valueStart, valueEnd), valueStart, valueEnd })
      } else if (name !== '') {
        uncovered++
      }
      if (unterminated) unterminatedAt = valueEnd
    } else if (text.slice(pos, end).trim() !== '') {
      uncovered++ // 没有冒号的残片，算未覆盖内容而非失败
      if (unterminated) unterminatedAt = trimValueEnd(text, pos, end)
    }

    if (end >= to) break
    pos = end + 1
  }
  return { tokens, uncovered, unterminatedAt }
}

/** 追加 token 时用的缩进（沿用块内已有声明的缩进，退化为两空格）。 */
function indentOf(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const m = /^[ \t]*/.exec(text.slice(lineStart, at))
  return m ? m[0] : '  '
}

/**
 * 定点替换某 token 的值：**只改值区间那一段字符**，注释 / 空行 / 缩进 / GUI 不认识的一切
 * 逐字保留。文件里没有该 token 则在 `.player` 块内追加一行；没有 `.player` 块则在末尾补一个。
 * 解析失败时原样返回——绝不猜着写回。
 */
export function setTokenValue(text: string, name: string, value: string): string {
  const scan = scanThemeCss(text)
  if (!scan.ok) return text

  const hit = scan.tokens.find((t) => t.name === name)
  if (hit) return text.slice(0, hit.valueStart) + value + text.slice(hit.valueEnd)

  // 追加进最后一个顶层 .player 块
  const block = lastPlayerBlock(text)
  if (block) {
    const inner = scanDeclarations(text, block.open + 1, block.close)
    const indent = inner && inner.tokens.length > 0 ? indentOf(text, inner.tokens[0].valueStart) : '  '
    let head = text.slice(0, block.close)
    // 末条声明省了分号（合法且本扫描器接受）——不先补上，追加行就会被吞进它的值里：
    // 上一条的行内注释被删、被追加的这条从此不存在，正是本机制承诺绝不发生的事。
    if (inner?.unterminatedAt != null) {
      head = `${head.slice(0, inner.unterminatedAt)};${head.slice(inner.unterminatedAt)}`
    }
    const line = (head.endsWith('\n') ? '' : '\n') + `${indent}${name}: ${value};\n`
    return head + line + text.slice(block.close)
  }
  const sep = text === '' || text.endsWith('\n') ? '' : '\n'
  return `${text}${sep}\n.player {\n  ${name}: ${value};\n}\n`
}

/** 最后一个顶层 `.player` 规则块的花括号位置；没有返回 null。 */
function lastPlayerBlock(text: string): { open: number; close: number } | null {
  let pos = 0
  let found: { open: number; close: number } | null = null
  for (;;) {
    pos = skipTrivia(text, pos)
    if (pos === -1 || pos >= text.length) return found
    const open = findTop(text, pos, '{};')
    if (open < 0) return found
    if (text[open] === ';') { pos = open + 1; continue }
    if (text[open] === '}') return found
    const close = findBlockEnd(text, open)
    if (close === -1) return found
    if (isPlayerSelector(text.slice(pos, open))) found = { open, close }
    pos = close + 1
  }
}
