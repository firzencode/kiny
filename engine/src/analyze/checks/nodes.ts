import type { Diagnostic, SymbolTable } from '../types'

/**
 * `$nodes` 字面访问的编译期校验：字面属性（`$nodes.商店`、`$nodes.商店.内室`）与字符串字面量
 * 下标（`$nodes["商店"]`）校验存在性；字面调用（`$nodes.店(a, b)`）校验 arity；stitch / END / DONE
 * 字面调用报不可调用。计算下标（`$nodes[变量]`）不在此列（留给运行时访问即校验）。
 * 合成开场 knot（`scope === 'global'`）不暴露给 `$nodes`，按不存在处理。
 */
export function checkNodes(table: SymbolTable): Diagnostic[] {
  const out: Diagnostic[] = []

  const authorKnot = (name: string) => {
    const k = table.knots.get(name)
    return k !== undefined && k.scope !== 'global' ? k : null
  }

  for (const frag of table.fragments) {
    for (const a of frag.nodesAccess) {
      const { path, argc } = a
      if (path === 'END' || path === 'DONE') {
        if (argc !== null) {
          out.push({ severity: 'error', code: 'node-not-callable', message: `${path} 引用不可调用`, file: frag.file, line: frag.line })
        }
        continue
      }
      const dot = path.indexOf('.')
      if (dot !== -1) {
        const parent = path.slice(0, dot)
        const child = path.slice(dot + 1)
        if (authorKnot(parent) === null || table.stitches.get(parent)?.has(child) !== true) {
          out.push({ severity: 'error', code: 'unknown-node', message: `节点不存在：「${path}」`, file: frag.file, line: frag.line })
          continue
        }
        if (argc !== null) {
          out.push({ severity: 'error', code: 'node-not-callable', message: `子节点引用不可调用（子节点无参数）：「${path}」`, file: frag.file, line: frag.line })
        }
        continue
      }
      const knot = authorKnot(path)
      if (knot === null) {
        out.push({ severity: 'error', code: 'unknown-node', message: `节点不存在：「${path}」`, file: frag.file, line: frag.line })
        continue
      }
      if (argc !== null && argc !== knot.params.length) {
        out.push({ severity: 'error', code: 'node-arity', message: `节点「${path}」需 ${knot.params.length} 个实参，调用给了 ${argc} 个`, file: frag.file, line: frag.line })
      }
    }
  }
  return out
}
