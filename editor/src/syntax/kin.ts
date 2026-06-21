/**
 * Kin 语言的行级语义 tokenizer + 节点解析。纯函数，editor 的语义着色与节点导航共用。
 *
 * 设计取向：宽容而非严格——这是「着色 + 导航」用的轻量分词，不是第二个 parser。
 * 真正的语法/语义判定由 @kiny/engine 的 parse/analyze 负责（见 validate.ts）。
 * 因此这里只求「看起来对、拼回原文一字不差」，不追求与 engine 语法 100% 同构。
 */

export interface Token {
  cls: string
  text: string
}

export interface NodeInfo {
  name: string
  line: number // 1-based
  diverts: number // 节点体内 -> 的出现次数
}

const KEYWORD = /^(let|true|false|null|END)$/
const FUNC = /^(random|shuffle|cycle|seq|once|turns_since|turns)$/

/** 一段「纯文本/表达式」里的行内 token：字符串 / 插值 / 跳转 / 选项括号 / 命令 / 标识符 / 数字。 */
function inlineTokens(s: string): Token[] {
  const out: Token[] = []
  const re =
    /("(?:[^"\\]|\\.)*")|(\{[^}]*\})|(->\s*[^\s[\](){}]+)|(\[[^\]]*\])|(@[A-Za-z_]\w*)|([A-Za-z_]\w*)|(\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ cls: 't-text', text: s.slice(last, m.index) })
    if (m[1]) out.push({ cls: 't-string', text: m[1] })
    else if (m[2]) {
      out.push({ cls: 't-interp', text: '{' })
      for (const t of inlineTokens(m[2].slice(1, -1))) out.push(t)
      out.push({ cls: 't-interp', text: '}' })
    } else if (m[3]) out.push({ cls: 't-divert', text: m[3] })
    else if (m[4]) out.push({ cls: 't-bracket', text: m[4] })
    else if (m[5]) out.push({ cls: 't-command', text: m[5] })
    else if (m[6])
      out.push({ cls: KEYWORD.test(m[6]) ? 't-keyword' : FUNC.test(m[6]) ? 't-interp' : 't-text', text: m[6] })
    else if (m[7]) out.push({ cls: 't-num', text: m[7] })
    last = re.lastIndex
  }
  if (last < s.length) out.push({ cls: 't-text', text: s.slice(last) })
  return out
}

export function tokenizeLine(raw: string): Token[] {
  if (raw.length === 0) return []
  const tokens: Token[] = []
  let rest = raw

  // 行尾注释（粗略：不在字符串中途切）
  let comment: string | null = null
  const ci = rest.indexOf('//')
  if (ci >= 0 && !/"[^"]*$/.test(rest.slice(0, ci))) {
    comment = rest.slice(ci)
    rest = rest.slice(0, ci)
  }
  if (raw.trim().startsWith('//')) return [{ cls: 't-comment', text: raw }]

  // 前导分支深度符 >
  const dm = rest.match(/^(\s*(?:>\s*)+)/)
  if (dm) {
    tokens.push({ cls: 'depth-guide', text: dm[1] })
    rest = rest.slice(dm[1].length)
  } else {
    const wm = rest.match(/^\s+/)
    if (wm) {
      tokens.push({ cls: 't-text', text: wm[0] })
      rest = rest.slice(wm[0].length)
    }
  }

  const t = rest.trimStart()
  const pad = rest.slice(0, rest.length - t.length)
  if (pad) tokens.push({ cls: 't-text', text: pad })

  const push = (cls: string, text: string) => tokens.push({ cls, text })
  const tail = () => {
    if (comment) push('t-comment', comment)
    return tokens
  }

  // 节点头 === name ===
  const nh = t.match(/^(===)(\s*)(.*?)(\s*)(===)\s*$/)
  if (nh) {
    push('t-node-d', nh[1])
    if (nh[2]) push('t-text', nh[2])
    push('t-node', nh[3])
    if (nh[4]) push('t-text', nh[4])
    push('t-node-d', nh[5])
    return tail()
  }
  // 子节点 = name
  const sh = t.match(/^(=\s+)(.*)$/)
  if (sh) {
    push('t-node-d', sh[1])
    push('t-node', sh[2])
    return tail()
  }
  // 选项标记 * +
  const cm = t.match(/^([*+]\s?)/)
  if (cm) {
    push('t-marker', cm[1])
    for (const x of inlineTokens(t.slice(cm[1].length))) tokens.push(x)
    return tail()
  }
  // 逻辑行 ~ ~~~
  const lm = t.match(/^(~~~|~)(\s?)/)
  if (lm) {
    push('t-logic', lm[1] + lm[2])
    for (const x of inlineTokens(t.slice(lm[0].length))) tokens.push(x)
    return tail()
  }
  // 其它（命令 @ / 普通正文）统一走行内分词
  for (const x of inlineTokens(t)) tokens.push(x)
  return tail()
}

export function parseNodes(src: string): NodeInfo[] {
  const lines = src.split('\n')
  const nodes: NodeInfo[] = []
  lines.forEach((ln, i) => {
    const m = ln.match(/^===\s*(.+?)\s*===\s*$/)
    if (m) nodes.push({ name: m[1], line: i + 1, diverts: 0 })
  })
  nodes.forEach((n, idx) => {
    const end = idx + 1 < nodes.length ? nodes[idx + 1].line - 1 : lines.length
    let d = 0
    for (let k = n.line; k < end; k++) {
      const mm = lines[k].match(/->/g)
      if (mm) d += mm.length
    }
    n.diverts = d
  })
  return nodes
}
