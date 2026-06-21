export interface LevelLine {
  level: number
  content: string
}

/**
 * 解析行首的 `>` 层级标记。去行首空白后，连续的 `>`（每个其后空白可选）计为层级；
 * `\>` 不算标记。返回层级数与剥掉标记前缀后的内容。
 */
export function splitLevel(text: string): LevelLine {
  let s = text.replace(/^\s+/, '')
  let level = 0
  while (s.startsWith('>')) {
    level += 1
    s = s.slice(1).replace(/^\s+/, '')
  }
  return { level, content: s }
}
