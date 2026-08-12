import { parse, type ContentBlock, type InlineSegment, type ProjectFile } from '@kiny/engine'

/**
 * 字数统计：基于 engine AST 数「正文字数」（仅 literal 文本段、剔除空白字符），
 * 不把 DSL 结构（节点头 / 命令 / 跳转 / 逻辑行 / 插值表达式）计入正文。
 * 解析失败时回落为行级启发式（保证 UI 永不空白；真实项目常态是解析成功）。
 */

export interface FileStats {
  path: string
  /** 正文字数：AST literal 文本段的非空白字符数（选项文本、条件分支正文都算）。 */
  textChars: number
  /** 总字符数：源码全文非空白字符数（含代码与 DSL 结构）。 */
  totalChars: number
  lines: number
  knots: number
  stitches: number
  choices: number
  commands: number
  diverts: number
}

export interface ProjectStats {
  files: FileStats[]
  textChars: number
  totalChars: number
  lines: number
  knots: number
  stitches: number
  choices: number
  commands: number
  diverts: number
}

/** 段数组 → 正文字符数：literal 计值，interp / break 不计。 */
function segmentsChars(segments: InlineSegment[]): number {
  let n = 0
  for (const s of segments) {
    if (s.kind === 'literal') n += nonWsChars(s.value)
  }
  return n
}

/** 非空白字符计数（中文习惯：空格 / 换行 / 制表不计）。 */
function nonWsChars(s: string): number {
  let n = 0
  for (const ch of s) if (!/\s/.test(ch)) n++
  return n
}

function walkBlock(block: ContentBlock, acc: { text: number; choices: number; commands: number; diverts: number }) {
  for (const el of block) {
    switch (el.kind) {
      case 'text':
        acc.text += segmentsChars(el.segments)
        break
      case 'choiceGroup':
        for (const c of el.choices) {
          acc.choices++
          acc.text += segmentsChars(c.before)
          if (c.inner) acc.text += segmentsChars(c.inner)
          acc.text += segmentsChars(c.after)
          if (c.label) acc.text += nonWsChars(c.label)
          if (c.resultDivert) acc.diverts++
          walkBlock(c.body, acc)
        }
        break
      case 'conditional':
        for (const b of el.branches) walkBlock(b.body, acc)
        break
      case 'command':
        acc.commands++
        break
      case 'divert':
        acc.diverts++
        break
      case 'logicLine':
      case 'logicBlock':
        // 代码不是正文，不计
        break
    }
  }
}

function fileStatsFromAst(file: ProjectFile): Omit<FileStats, 'totalChars' | 'lines'> {
  const acc = { text: 0, choices: 0, commands: 0, diverts: 0 }
  walkBlock(file.preamble, acc)
  let stitches = 0
  for (const knot of file.knots) {
    walkBlock(knot.body, acc)
    stitches += knot.stitches.length
    for (const st of knot.stitches) walkBlock(st.body, acc)
  }
  return {
    path: file.path,
    textChars: acc.text,
    knots: file.knots.length,
    stitches,
    choices: acc.choices,
    commands: acc.commands,
    diverts: acc.diverts,
  }
}

/** 解析失败的行级启发式：剔掉 DSL 结构行（节点头 / 子节点 / 命令 / 跳转 / 逻辑 / 赋值 / 选项标记），
 *  其余行去掉内联标签与插值后按非空白字符计数。 */
function heuristicTextChars(source: string): number {
  const structRe = /^\s*(===?|[+*](\s|$)|->|@[A-Za-z_]|~|@if|@elif|@else|\{)/u
  let n = 0
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (line === '' || structRe.test(line)) continue
    const cleaned = line
      .replace(/<[^>]*>/g, '') // 内联富文本标签
      .replace(/\{[^}]*\}/g, '') // 插值表达式
    n += nonWsChars(cleaned)
  }
  return n
}

/** 单个文件统计；解析失败回落启发式（totalChars / lines 始终按原文）。 */
export function fileStats(source: string, path: string): FileStats {
  let s: Omit<FileStats, 'totalChars' | 'lines'>
  try {
    s = fileStatsFromAst(parse(source, path))
  } catch {
    s = {
      path, textChars: heuristicTextChars(source),
      knots: 0, stitches: 0, choices: 0, commands: 0, diverts: 0,
    }
  }
  return {
    ...s,
    totalChars: nonWsChars(source),
    lines: source === '' ? 0 : source.split('\n').length,
  }
}

/** 项目汇总：按文件求和（不重复解析；调用方传缓冲即可）。 */
export function projectStats(buffers: { path: string; source: string }[]): ProjectStats {
  const files = buffers.map((b) => fileStats(b.source, b.path)).sort((a, b) => (a.path < b.path ? -1 : 1))
  const sum = (pick: (f: FileStats) => number) => files.reduce((acc, f) => acc + pick(f), 0)
  return {
    files,
    textChars: sum((f) => f.textChars),
    totalChars: sum((f) => f.totalChars),
    lines: sum((f) => f.lines),
    knots: sum((f) => f.knots),
    stitches: sum((f) => f.stitches),
    choices: sum((f) => f.choices),
    commands: sum((f) => f.commands),
    diverts: sum((f) => f.diverts),
  }
}

/** 供 UI 一次性取「当前文件 + 项目」双口径的便捷入口。 */
export function statsFor(
  buffers: { path: string; source: string }[],
  active: { path: string; source: string } | null,
): { file: FileStats | null; project: ProjectStats } {
  const project = projectStats(buffers)
  const file = active ? fileStats(active.source, active.path) : null
  return { file, project }
}
