import type { ProjectFile } from '../../parser/ast'
import type { Diagnostic } from '../types'

/** 节点全局重名 + 子节点同父内重名。按文件名字典序遍历，报在后出现的那个。 */
export function checkNames(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const seenKnot = new Set<string>()
  for (const file of sorted) {
    for (const knot of file.knots) {
      if (seenKnot.has(knot.name)) {
        out.push({ severity: 'error', code: 'duplicate-knot', message: `节点名重复：「${knot.name}」`, file: file.path, line: knot.line })
      } else {
        seenKnot.add(knot.name)
      }
      const seenStitch = new Set<string>()
      for (const st of knot.stitches) {
        if (seenStitch.has(st.name)) {
          out.push({ severity: 'error', code: 'duplicate-stitch', message: `子节点名在「${knot.name}」内重复：「${st.name}」`, file: file.path, line: st.line })
        } else {
          seenStitch.add(st.name)
        }
      }
    }
  }
  return out
}
