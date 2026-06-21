import type { ProjectFile } from '../parser/ast'
import { parse, ParseError } from '../parser'
import type { KinyMeta, LoadResult, ProjectError } from './types'

/** 把「归一 path → 源文本」组装为已解析的 ProjectFile[]：逐个 parse（收集全部解析错）、校验 entry 在文件集、按 path 字典序排序。不跑 analyze。 */
export function assembleProject(meta: KinyMeta, files: Map<string, string>): LoadResult {
  const errors: ProjectError[] = []
  const parsed: ProjectFile[] = []
  for (const [path, content] of files) {
    try {
      parsed.push(parse(content, path))
    } catch (e) {
      if (e instanceof ParseError) errors.push({ kind: 'parse', message: e.message, file: e.path ?? path, line: e.line })
      else throw e
    }
  }
  if (!files.has(meta.entry)) {
    errors.push({ kind: 'manifest', message: `entry 指向的文件不存在: ${meta.entry}`, file: 'kiny.json' })
  }
  if (errors.length > 0) return { ok: false, errors }
  parsed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { ok: true, files: parsed, entry: meta.entry, meta }
}
