/** 计算拖拽移动的目标路径；非法移动（原位 / 移入自身子树 / 空源）返回 null。 */
export function moveTarget(from: string, toDir: string): string | null {
  if (from === '') return null
  const name = from.slice(from.lastIndexOf('/') + 1)
  const to = toDir ? `${toDir}/${name}` : name
  if (to === from) return null
  if (toDir === from || toDir.startsWith(`${from}/`)) return null
  return to
}

export interface TreeNode {
  name: string          // 末段名（显示）
  path: string          // 相对项目根全路径
  kind: 'dir' | 'file'
  isKin?: boolean       // file 才有
  children?: TreeNode[] // dir 才有
}

/** 从扁平文件列表 + 空目录列表现算多层树；文件夹排前、同级名升序。 */
export function buildTree(
  files: { path: string; isKin: boolean }[],
  emptyDirs: string[],
): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] }
  const dirAt = (parts: string[]): TreeNode => {
    let cur = root
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      let next = cur.children!.find((c) => c.kind === 'dir' && c.name === part)
      if (!next) { next = { name: part, path: acc, kind: 'dir', children: [] }; cur.children!.push(next) }
      cur = next
    }
    return cur
  }
  for (const d of emptyDirs) if (d) dirAt(d.split('/'))
  for (const f of files) {
    const parts = f.path.split('/')
    const fileName = parts.pop()!
    dirAt(parts).children!.push({ name: fileName, path: f.path, kind: 'file', isKin: f.isKin })
  }
  const sortRec = (n: TreeNode) => {
    if (!n.children) return
    n.children.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root.children!
}
