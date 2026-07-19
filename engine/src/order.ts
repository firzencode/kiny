/**
 * 按 `path` 字典序返回**新**排序数组（不改原数组）。
 *
 * 语义关键：文件顺序决定全局构建序（§7.6 preamble 执行序）、结构指纹、choice 序号，
 * 各处必须用同一个比较器，否则存档 / 枚举两端会错位。全仓统一收敛到这里。
 */
export function sortByPath<T extends { path: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
