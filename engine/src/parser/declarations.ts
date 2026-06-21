import { ParseError } from './errors'

export interface KnotHeader {
  name: string
  params: string[]
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 校验节点/子节点名：非空、且不含空白字符（允许任意其他 Unicode）。 */
function validateNodeName(name: string, line: number): void {
  if (name === '') {
    throw new ParseError('节点缺少名字', line)
  }
  if (/\s/.test(name)) {
    throw new ParseError(`节点名不能包含空格：「${name}」`, line)
  }
}

/** 校验 ASCII 标识符（参数名规则同变量，§7）。 */
function validateIdentifier(id: string, line: number): void {
  if (!IDENTIFIER.test(id)) {
    throw new ParseError(`参数名必须是 ASCII 标识符：「${id}」`, line)
  }
}

/** 解析 "名字" 或 "名字(p1, p2)" 形态的中段。 */
function parseNameAndParams(middle: string, line: number): KnotHeader {
  const paren = middle.indexOf('(')
  if (paren === -1) {
    validateNodeName(middle, line)
    return { name: middle, params: [] }
  }
  if (!middle.endsWith(')')) {
    throw new ParseError('参数列表缺少右括号 )', line)
  }
  const name = middle.slice(0, paren)
  validateNodeName(name, line)
  const inner = middle.slice(paren + 1, -1).trim()
  if (inner === '') {
    return { name, params: [] }
  }
  const params = inner.split(',').map((p) => p.trim())
  for (const p of params) {
    validateIdentifier(p, line)
  }
  return { name, params }
}

/**
 * 解析节点声明 `=== 名字 ===` / `=== 名字(参数) ===`。
 * 调用方已确认该行去空白后以多个 `=` 起首（非单个 `=`）。
 */
export function parseKnotHeader(text: string, line: number): KnotHeader {
  const t = text.trim()
  const m = /^(=+)\s*(.*?)\s*(=+)$/.exec(t)
  if (!m) {
    throw new ParseError('节点声明格式错误，应为 === 名字 ===', line)
  }
  const lead = m[1]!.length
  const trail = m[3]!.length
  if (lead !== 3 || trail !== 3) {
    throw new ParseError(`节点声明必须左右各 3 个等号（这里 ${lead}/${trail}）`, line)
  }
  return parseNameAndParams(m[2]!, line)
}

/**
 * 解析子节点声明 `= 名字`。
 * 调用方已确认该行去空白后以单个 `=` 起首。
 */
export function parseStitchHeader(text: string, line: number): string {
  const rest = text.trim().slice(1).trim()
  validateNodeName(rest, line)
  return rest
}
