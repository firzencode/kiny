import { ParseError } from './errors'
import { findInterpEnd } from './interp'

/**
 * 把括号内原文按顶层逗号切分成 JS 实参表达式数组。
 * 跳过字符串字面量（"…" '…' `…`）与嵌套的 `()[]{}`；每段 trim；空内容得 []。
 * 字符串/括号未闭合 → ParseError。
 */
export function splitArgs(inner: string, line: number, path: string): string[] {
  if (inner.trim() === '') return []
  const args: string[] = []
  const n = inner.length
  let depth = 0
  let quote = ''
  let start = 0
  let i = 0
  while (i < n) {
    const c = inner[i]!
    if (quote !== '') {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote) quote = ''
      i += 1
      continue
    }
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i += 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth += 1
      i += 1
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1
      i += 1
      continue
    }
    if (c === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim())
      i += 1
      start = i
      continue
    }
    i += 1
  }
  if (quote !== '') {
    throw new ParseError('实参表中字符串未闭合', line, path)
  }
  if (depth !== 0) {
    throw new ParseError('实参表中括号不配平', line, path)
  }
  args.push(inner.slice(start).trim())
  return args
}

/**
 * 解析跳转 `-> 目标` / `-> 目标(实参)` / `-> {表达式}`（动态目标），返回 target 与 args，
 * 动态形态另带 targetExpr（此时 target=''、args=[]）。调用方已确认以 `->` 起首。
 */
export function parseDivert(
  raw: string,
  line: number,
  path: string,
): { target: string; args: string[]; targetExpr?: string } {
  const s = raw.trim().slice(2).trim() // 去掉 ->
  if (s.startsWith('{')) {
    // 动态目标：{ 到配对 } 整段是 JS 表达式（findInterpEnd 跳过字符串字面量与嵌套花括号）。
    const end = findInterpEnd(s, 0)
    if (end === -1) {
      throw new ParseError('动态跳转 { 未闭合', line, path)
    }
    if (s.slice(end).trim() !== '') {
      throw new ParseError('动态跳转 } 之后不允许再接内容（实参在 JS 侧经 $nodes 绑定）', line, path)
    }
    const expr = s.slice(1, end - 1).trim()
    if (expr === '') {
      throw new ParseError('动态跳转表达式为空', line, path)
    }
    return { target: '', args: [], targetExpr: expr }
  }
  const paren = s.indexOf('(')
  if (paren === -1) {
    if (s === '') {
      throw new ParseError('跳转缺少目标', line, path)
    }
    return { target: s, args: [] }
  }
  if (!s.endsWith(')')) {
    throw new ParseError('跳转实参缺少右括号 )', line, path)
  }
  const target = s.slice(0, paren).trim()
  if (target === '') {
    throw new ParseError('跳转缺少目标', line, path)
  }
  return { target, args: splitArgs(s.slice(paren + 1, -1), line, path) }
}

/** 解析命令 `@名字(实参)`，返回 name 与 args。 */
export function parseCommand(raw: string, line: number, path: string): { name: string; args: string[] } {
  const s = raw.trim()
  const m = /^@([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(s)
  if (!m) {
    throw new ParseError('命令应为 @名字(...) 形式', line, path)
  }
  if (!s.endsWith(')')) {
    throw new ParseError('命令实参缺少右括号 )', line, path)
  }
  return { name: m[1]!, args: splitArgs(s.slice(m[0].length, -1), line, path) }
}
