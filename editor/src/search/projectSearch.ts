import { isTextFile } from '../files/gateway'

/**
 * 跨文件搜索 / 替换：纯文本处理，作用于**编辑缓冲**（内存最新内容，含未保存改动）。
 * 搜索目标 = 项目内全部可编辑文本文件（.kin / theme.css / 作品 css / json / txt / md 等，
 * 口径同 files 层 isTextFile）。替换产出新源码，由调用方 dispatch source_changed 落脏标记。
 */

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface SearchMatch {
  path: string
  /** 1 起行号。 */
  line: number
  /** 行内 0 起列（匹配起点）。 */
  col: number
  /** 该行原文（展示用，超长由 UI 截断）。 */
  text: string
  /** 匹配到的子串。 */
  matched: string
}

/** 构建搜索正则；查询为空 / 非法正则抛 Error（UI 转提示文案）。 */
export function buildSearchRe(query: string, opts: SearchOptions): RegExp {
  if (query === '') throw new Error('搜索内容为空')
  const source = opts.regex ? query : escapeRe(query)
  const body = opts.wholeWord ? `(?<![A-Za-z0-9_])(${source})(?![A-Za-z0-9_])` : `(${source})`
  const flags = opts.caseSensitive ? 'g' : 'giu'
  try {
    return new RegExp(body, flags)
  } catch (e) {
    throw new Error(`搜索表达式无效：${e instanceof Error ? e.message : String(e)}`)
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 单文件内搜索。 */
export function searchText(source: string, path: string, query: string, opts: SearchOptions): SearchMatch[] {
  const re = buildSearchRe(query, opts)
  const out: SearchMatch[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    const lineText = lines[i]!
    let m: RegExpExecArray | null
    while ((m = re.exec(lineText)) !== null) {
      out.push({ path, line: i + 1, col: m.index, text: lineText, matched: m[1] ?? m[0] })
      if (m[0] === '') re.lastIndex++ // 空匹配防死循环
    }
  }
  return out
}

/** 跨缓冲搜索（只搜可编辑文本文件）。 */
export function searchBuffers(
  buffers: { path: string; source: string }[],
  query: string,
  opts: SearchOptions,
): SearchMatch[] {
  const out: SearchMatch[] = []
  for (const b of buffers) {
    if (!isTextFile(b.path)) continue
    out.push(...searchText(b.source, b.path, query, opts))
  }
  return out
}

/**
 * 字面替换：replacement 一律按字面文本插入（即使 regex 搜索也不展开 $1 之类占位符）。
 * 返回替换后源码与命中次数；查询无效抛 Error。
 */
export function replaceInText(
  source: string,
  query: string,
  replacement: string,
  opts: SearchOptions,
): { source: string; count: number } {
  const re = buildSearchRe(query, opts)
  let count = 0
  const next = source.replace(re, () => {
    count++
    return replacement
  })
  return { source: next, count }
}

/** 分组视图：匹配结果按文件归组（保持缓冲传入顺序）。 */
export function groupByFile(matches: SearchMatch[]): { path: string; matches: SearchMatch[] }[] {
  const groups: { path: string; matches: SearchMatch[] }[] = []
  for (const m of matches) {
    const last = groups[groups.length - 1]
    if (last && last.path === m.path) last.matches.push(m)
    else groups.push({ path: m.path, matches: [m] })
  }
  return groups
}
