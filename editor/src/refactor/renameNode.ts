import { parse, sortByPath, type ContentBlock, type Divert, type Knot, type ProjectFile } from '@kiny/engine'
import { isKinFile } from '../files/gateway'

/**
 * 节点安全重命名：基于 engine AST 计算重命名计划（定义 + 全部静态跳转引用），
 * 消歧规则与 engine analyze/checks/diverts 完全一致：
 *   - 无 `.` 目标：**全局 knots 优先**，其次宿主同级 stitch；
 *   - `父.子` 限定名：knots[父].stitches[子]；
 *   - 动态跳转 `-> {表达式}` 不处理（目标运行期才定）。
 * 应用时只替换「目标名 token」本身，`-> 名(实参)` 的实参、`父.子` 的 `.子` 部分原样保留。
 * 替换按偏移从后往前落，产出整文件新源码，由调用方 dispatch 落脏标记（不写盘）。
 */

export interface RenameTarget {
  path: string
  name: string
}

export interface RenameChange {
  path: string
  /** 源文本内偏移 [from, to)。 */
  from: number
  to: number
  /** 该处替换后的文本（目标名 token）。 */
  text: string
}

export interface RenameWarning {
  /** 'stitch-shadow'：新名与其它节点的子节点重名，那些子节点内部的裸跳转将改指本节点。 */
  kind: 'stitch-shadow'
  message: string
}

export interface RenamePlan {
  targetPath: string
  oldName: string
  newName: string
  changes: RenameChange[]
  /** 引用处数量（不含定义头）。 */
  referenceCount: number
  affectedFiles: string[]
  warnings: RenameWarning[]
}

const RESERVED = new Set(['END', 'DONE'])

/** 新名合法性：非空、无空白、无 `.`（限定名分隔）与 `(` / `)`、非 END/DONE。 */
export function validateNewName(newName: string, oldName: string): string | null {
  if (newName === oldName) return '新名与原名相同'
  if (newName === '') return '节点名不能为空'
  if (/\s/.test(newName)) return '节点名不能包含空格'
  if (newName.includes('.')) return '节点名不能包含「.」（限定名分隔符）'
  if (/[()]/.test(newName)) return '节点名不能包含括号'
  if (RESERVED.has(newName)) return `「${newName}」是保留跳转目标，不能用作节点名`
  return null
}

interface Index {
  knots: Map<string, { file: ProjectFile; knot: Knot }>
  stitches: Map<string, Set<string>>
}

function buildIndex(files: ProjectFile[]): Index {
  const knots = new Map<string, { file: ProjectFile; knot: Knot }>()
  const stitches = new Map<string, Set<string>>()
  for (const f of files) {
    for (const k of f.knots) {
      knots.set(k.name, { file: f, knot: k })
      stitches.set(k.name, new Set(k.stitches.map((s) => s.name)))
    }
  }
  return { knots, stitches }
}

/** 定位行内 `->` 之后的目标名 token 偏移；找不到（理论不可能）返回 null。 */
function divertTokenSpan(source: string, line: number, targetToken: string): { from: number; to: number } | null {
  const lines = source.split('\n')
  const text = lines[line - 1]
  if (text === undefined) return null
  const arrow = text.indexOf('->')
  if (arrow < 0) return null
  const idx = text.indexOf(targetToken, arrow + 2)
  if (idx < 0) return null
  const lineStart = lines.slice(0, line - 1).reduce((acc, l) => acc + l.length + 1, 0)
  return { from: lineStart + idx, to: lineStart + idx + targetToken.length }
}

/** 头行内节点名 token 偏移（`=== 名字 ===` / `=== 名字(p) ===`）。 */
function knotHeaderSpan(source: string, line: number, name: string): { from: number; to: number } | null {
  const lines = source.split('\n')
  const text = lines[line - 1]
  if (text === undefined) return null
  const idx = text.indexOf(name)
  if (idx < 0) return null
  const lineStart = lines.slice(0, line - 1).reduce((acc, l) => acc + l.length + 1, 0)
  return { from: lineStart + idx, to: lineStart + idx + name.length }
}

/** 静态跳转是否指向被重命名的节点；命中时返回「应替换的 token」。 */
function resolveDivert(
  d: Divert,
  host: Knot,
  index: Index,
  oldName: string,
): string | null {
  if (d.targetExpr !== undefined) return null // 动态跳转：目标运行期才定
  const t = d.target
  if (t === 'END' || t === 'DONE') return null
  const dot = t.indexOf('.')
  if (dot !== -1) {
    const parent = t.slice(0, dot)
    if (parent === oldName && index.knots.has(oldName) && index.stitches.get(oldName)?.has(t.slice(dot + 1))) {
      return parent // `oldName.子`：替换父段
    }
    return null
  }
  // 无 `.`：全局 knots 优先消歧，再宿主同级 stitch（与 checkDiverts 一致）。
  if (index.knots.has(t)) return t === oldName ? t : null
  if (index.stitches.get(host.name)?.has(t)) return null // 命中 stitch，与本节点无关
  return null
}

/** 遍历一个 block 树，收集指向 oldName 的静态跳转（含选项 resultDivert）。 */
function collectFromBlock(
  block: ContentBlock,
  host: Knot,
  file: ProjectFile,
  index: Index,
  oldName: string,
  newName: string,
  changes: RenameChange[],
) {
  const walk = (b: ContentBlock) => {
    for (const el of b) {
      if (el.kind === 'divert') {
        const token = resolveDivert(el, host, index, oldName)
        if (token !== null) {
          const span = divertTokenSpan(fileSource(file) ?? '', el.line, token)
          if (span) changes.push({ path: file.path, from: span.from, to: span.to, text: newName })
        }
      } else if (el.kind === 'choiceGroup') {
        for (const c of el.choices) {
          if (c.resultDivert !== null) {
            const token = resolveDivert(c.resultDivert, host, index, oldName)
            if (token !== null) {
              const span = divertTokenSpan(fileSource(file) ?? '', c.resultDivert.line, token)
              if (span) changes.push({ path: file.path, from: span.from, to: span.to, text: newName })
            }
          }
          walk(c.body)
        }
      } else if (el.kind === 'conditional') {
        for (const br of el.branches) walk(br.body)
      }
    }
  }
  walk(block)
}

/** 已解析文件 → 原文（重命名计划只对可解析文件工作；解析失败的源不参与）。 */
function fileSource(file: ProjectFile): string | null {
  return (file as ProjectFile & { source?: string }).source ?? null
}

/**
 * 计算重命名计划。目标必须是顶层节点（knot）；文件解析失败 / 目标不存在 / 新名非法抛 Error。
 * sources 传入全部 .kin 缓冲（含未保存改动——重命名作用于编辑缓冲，不碰磁盘）。
 */
export function computeRenamePlan(
  sources: { path: string; source: string }[],
  target: RenameTarget,
  newName: string,
): RenamePlan {
  const err = validateNewName(newName, target.name)
  if (err !== null) throw new Error(err)

  const parsed: ProjectFile[] = []
  for (const s of sortByPath(sources.map((x) => ({ path: x.path, source: x.source })))) {
    if (!isKinFile(s.path)) continue
    try {
      const file = parse(s.source, s.path)
      parsed.push({ ...file, source: s.source } as ProjectFile & { source: string })
    } catch (e) {
      throw new Error(`无法解析 ${s.path}：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const index = buildIndex(parsed)
  const entry = index.knots.get(target.name)
  if (!entry) throw new Error(`节点不存在：「${target.name}」`)
  if (index.knots.has(newName)) throw new Error(`节点名已存在：「${newName}」`)

  // 新名与本节点自己的子节点重名 → 节点内裸跳转消歧翻转，硬禁止。
  if (index.stitches.get(target.name)?.has(newName)) {
    throw new Error(`新名与本节点子节点「${newName}」重名，会改变节点内裸跳转的指向`)
  }

  const changes: RenameChange[] = []
  // 定义头
  const defSpan = knotHeaderSpan((entry.file as ProjectFile & { source?: string }).source ?? '', entry.knot.line, target.name)
  if (defSpan) changes.push({ path: entry.file.path, from: defSpan.from, to: defSpan.to, text: newName })

  // 引用：每个文件的 preamble（host=合成开场）+ 各 knot 正文 + 各 stitch 正文
  for (const file of parsed) {
    if (file.preamble.length > 0) {
      const openingHost: Knot = {
        kind: 'knot', name: `\u0000opening:${file.path}`, params: [],
        body: file.preamble, stitches: [], line: file.preamble[0]!.line, scope: 'global',
      }
      collectFromBlock(file.preamble, openingHost, file, index, target.name, newName, changes)
    }
    for (const knot of file.knots) {
      collectFromBlock(knot.body, knot, file, index, target.name, newName, changes)
      for (const st of knot.stitches) collectFromBlock(st.body, knot, file, index, target.name, newName, changes)
    }
  }

  // 引用处新名与其它节点子节点重名 → 警告（不阻止）
  const warnings: RenameWarning[] = []
  for (const [parent, stitches] of index.stitches) {
    if (parent === target.name) continue
    if (stitches.has(newName)) {
      warnings.push({
        kind: 'stitch-shadow',
        message: `新名与节点「${parent}」的子节点「${newName}」重名：该子节点内部的裸跳转「-> ${newName}」今后将指向本节点`,
      })
    }
  }

  // 应用序去重（同文件内按偏移从后往前应用即可，无需排序给调用方——applyRename 自行处理）
  const affectedFiles = [...new Set(changes.map((c) => c.path))]
  return {
    targetPath: target.path,
    oldName: target.name,
    newName,
    changes,
    // 定义头恒为恰好一处，其余皆为引用
    referenceCount: Math.max(0, changes.length - 1),
    affectedFiles,
    warnings,
  }
}

/** 应用计划：返回每个受影响文件的新源码（未受影响的文件不含在内）。 */
export function applyRename(
  buffers: { path: string; source: string }[],
  plan: RenamePlan,
): { path: string; source: string }[] {
  const byPath = new Map<string, string>()
  for (const b of buffers) byPath.set(b.path, b.source)
  const grouped = new Map<string, RenameChange[]>()
  for (const c of plan.changes) {
    const list = grouped.get(c.path) ?? []
    list.push(c)
    grouped.set(c.path, list)
  }
  const out: { path: string; source: string }[] = []
  for (const [path, cs] of grouped) {
    const source = byPath.get(path)
    if (source === undefined) continue
    let next = source
    for (const c of [...cs].sort((a, b) => b.from - a.from)) {
      next = next.slice(0, c.from) + c.text + next.slice(c.to)
    }
    out.push({ path, source: next })
  }
  return out
}
