/**
 * 从项目根「文件名列表」按统一规则挑选 manifest 文件（spec：定位 manifest）。
 * manifest 文件名可变（`<项目名>.kiw`），各 loader 不再硬编码 `kiny.json`，统一走此纯规则。
 *
 * - 恰好一个 `*.kiw` → 它是 manifest。
 * - 零个 `.kiw` 但存在 `kiny.json` → 用 `kiny.json`（向后兼容旧项目 / 旧 .kip）。
 * - 零个 `.kiw` 且无 `kiny.json` → 错误。
 * - 多个 `.kiw` → 错误。
 *
 * `names` 是项目根**文件名**（非路径、非递归）；顺序无关。
 */
export function findManifest(names: string[]): { ok: true; name: string } | { ok: false; message: string } {
  const kiws = names.filter((n) => n.endsWith('.kiw'))
  if (kiws.length === 1) return { ok: true, name: kiws[0]! }
  if (kiws.length > 1) return { ok: false, message: '项目根有多个 .kiw 文件' }
  if (names.includes('kiny.json')) return { ok: true, name: 'kiny.json' }
  return { ok: false, message: '不是 Kiny 项目（缺少 .kiw）' }
}
