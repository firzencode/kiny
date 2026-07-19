/** 从文件绝对路径派生父目录（跨平台：兼容 / 与 \ 分隔）。 */
export function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : p
}

/** 取路径末段文件名（兼容 Windows 反斜杠绝对路径，去尾部斜杠）。 */
export function basename(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm.slice(norm.lastIndexOf('/') + 1)
}

/** 某路径是否即 base 或其下后代（删除 / 改名同步入口 / 归属判定用）。 */
export function underPath(p: string, base: string): boolean {
  return p === base || p.startsWith(`${base}/`)
}

/**
 * 入口文件被改名 / 移动后，manifest 应写回的新 entry；入口不在 `from` 子树下则返回 null（无需改）。
 * 收敛 App onRename 与 ai/actions renamePath 两处原本各自复述的同步逻辑。
 */
export function entryAfterRename(entry: string, from: string, to: string): string | null {
  if (!underPath(entry, from)) return null
  return entry === from ? to : to + entry.slice(from.length)
}
