/**
 * 从 start 处的 `{` 开始寻找配平的 `}`，返回其后的下标；不配平返回 -1。
 * 识别字符串字面量（"…" '…' `…`），跳过串内的花括号；转义（`\x`）整体跳过两字符，故
 * `\{`/`\}` 不计入配平。pass 0 宽松（-1 当作吃到行尾），pass 3 严格（-1 报错）。
 */
export function findInterpEnd(s: string, start: number): number {
  const n = s.length
  let i = start
  let depth = 0
  let quote = ''
  while (i < n) {
    const c = s[i]!
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
    if (c === '{') {
      depth += 1
      i += 1
      continue
    }
    if (c === '}') {
      depth -= 1
      i += 1
      if (depth === 0) return i
      continue
    }
    i += 1
  }
  return -1
}
