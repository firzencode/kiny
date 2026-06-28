/**
 * Kin 规范的章节寻址（spec 2026-06-28-editor-ai-spec-query-design §3.1）。
 * 纯函数、无副作用、不导入构建资产，便于独立单测。
 */

/** 目录条目：章 / 节的 id、标题、层级（2=章，3=节）。 */
export interface SpecSection {
  id: string
  title: string
  level: number
}

/** 解析后的章节（含正文）。 */
export interface ParsedSection extends SpecSection {
  /** 正文：标题行起到下一个标题行前——故取章只得章引言、取叶子节得其全文。 */
  content: string
}

/** readKinSpec 的返回：某章节正文 + 直接子节清单。 */
export interface SpecSectionDetail {
  id: string
  title: string
  content: string
  children: { id: string; title: string }[]
}

const HEADING = /^(#{1,6})\s+(.+?)\s*$/
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$/

/**
 * 解析 Kin 规范 markdown 为带编号的章节列表。
 * - 仅标题文字带数字编号（`## 5. 选项`、`### 5.3 条件选项`）的标题进列表，id = 该编号。
 * - 无编号标题（如顶部一级标题）不进列表，但仍作为正文边界。
 * - 跳过 ``` 围栏代码块内的 # 行，避免把代码 / 示例里的 # 误判为标题。
 * - 正文 = 标题行起到下一个标题行前：取章只得章引言（下一行即首个子节标题），取叶子节得其全文。
 */
export function parseKinSpec(md: string): ParsedSection[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  // 先标出全部标题行（含无编号者，用于正文边界）。
  const headings: { line: number; level: number }[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue }
    if (inFence) continue
    const m = HEADING.exec(lines[i])
    if (m) headings.push({ line: i, level: m[1].length })
  }
  const sections: ParsedSection[] = []
  for (let h = 0; h < headings.length; h++) {
    const { line, level } = headings[h]
    const text = HEADING.exec(lines[line])![2]
    const nm = NUMBERED.exec(text)
    if (!nm) continue // 无编号标题不进列表
    const end = h + 1 < headings.length ? headings[h + 1].line : lines.length
    const content = lines.slice(line, end).join('\n').trimEnd()
    sections.push({ id: nm[1], title: nm[2], level, content })
  }
  return sections
}

/** 目录：剥掉正文，仅 id / title / level。 */
export function tableOfContents(sections: ParsedSection[]): SpecSection[] {
  return sections.map(({ id, title, level }) => ({ id, title, level }))
}

/** 取某章节正文 + 直接子节清单；id 不存在返回 undefined。 */
export function getSection(sections: ParsedSection[], id: string): SpecSectionDetail | undefined {
  const sec = sections.find((s) => s.id === id)
  if (!sec) return undefined
  const childDepth = id.split('.').length + 1
  const children = sections
    .filter((s) => s.id.startsWith(`${id}.`) && s.id.split('.').length === childDepth)
    .map(({ id, title }) => ({ id, title }))
  return { id: sec.id, title: sec.title, content: sec.content, children }
}
