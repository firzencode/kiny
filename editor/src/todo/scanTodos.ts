/**
 * 扫描项目脚本里的 `// TODO` / `// FIXME` 待办标记（T075）。编辑器侧逐行正则，不复用 parser 的精确
 * 注释识别——只要行内 `//` 或 `/*` 紧跟 `TODO`/`FIXME`（大小写敏感）即收，不判断是否真在注释区。
 * 待办面板是辅助工具而非编译器，字符串里误写 `// TODO` 的极罕见误报可接受（提示而非保证）。
 */

import { isKinFile } from '../files/gateway'

export interface TodoItem {
  path: string // 所属 .kin 文件项目内路径
  line: number // 1-based 行号，与 onJump 一致
  tag: 'TODO' | 'FIXME'
  text: string // 标记后的尾随文本（trim、去块注释尾 */）
}

// `//` 或 `/*`，可选空白，大写 TODO/FIXME（词边界），可选半/全角冒号，捕获尾随文本。
const TODO_RE = /(?:\/\/|\/\*)\s*(TODO|FIXME)\b[:：]?\s*(.*)/

/**
 * 扫描多个文件，汇总 TODO/FIXME 待办。只扫 `.kin` 文件（非脚本资源跳过）。
 * 输出稳定排序：path 字典序 → 同文件内 line 升序（面板顺序稳定）。
 */
export function scanTodos(files: { path: string; text: string }[]): TodoItem[] {
  const out: TodoItem[] = []
  for (const f of files) {
    if (!isKinFile(f.path)) continue
    const lines = f.text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = TODO_RE.exec(lines[i]!)
      if (!m) continue
      // 去掉可能的块注释尾 */ 与首尾空白。
      const text = m[2]!.replace(/\s*\*\/\s*$/, '').trim()
      out.push({ path: f.path, line: i + 1, tag: m[1] as 'TODO' | 'FIXME', text })
    }
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line))
  return out
}

/** 按文件分组（保持 scanTodos 的稳定顺序）。 */
export function groupTodosByFile(items: TodoItem[]): { path: string; items: TodoItem[] }[] {
  const groups: { path: string; items: TodoItem[] }[] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.path === it.path) last.items.push(it)
    else groups.push({ path: it.path, items: [it] })
  }
  return groups
}
