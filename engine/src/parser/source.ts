/** 源文件中的一行，带 1 起的行号。text 为去掉行尾换行后的原始内容（不裁剪首尾空白）。 */
export interface SourceLine {
  line: number
  text: string
}

/** 把 CRLF 与单独 CR 归一成 LF。行拓扑的唯一归一化入口，供 splitLines 与 pass 0 共用。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * 把源文本切成带 1 起行号的行。先把 CRLF 与单独 CR 归一成 LF，
 * 再按 LF 切分；文件结尾的单个换行不产生额外空行。
 */
export function splitLines(text: string): SourceLine[] {
  const parts = normalizeNewlines(text).split('\n')
  if (parts.length > 1 && parts[parts.length - 1] === '') {
    parts.pop()
  }
  return parts.map((t, i) => ({ line: i + 1, text: t }))
}
