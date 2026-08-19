import type { KinyMeta } from './types'

/** 校验 manifest（`<项目名>.kiw` 或旧 kiny.json）：四字段须为非空字符串，`id` 可选（非空字符串才透传，其余一律当没有、不报错）；合法返回 KinyMeta，否则返回错误消息数组（一次报全）。manifestName 供错误消息定位。 */
export function validateManifest(raw: unknown, manifestName = 'kiny.json'): KinyMeta | string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [`${manifestName} 不是 JSON 对象`]
  const o = raw as Record<string, unknown>
  const errs: string[] = []
  const need = (k: keyof KinyMeta) => {
    const v = o[k]
    if (typeof v !== 'string' || v.trim() === '') errs.push(`缺少或非法字段: ${k}（须为非空字符串）`)
  }
  need('name')
  need('version')
  need('engine')
  need('entry')
  if (errs.length > 0) return errs
  const meta: KinyMeta = { name: o.name as string, version: o.version as string, engine: o.engine as string, entry: o.entry as string }
  // id 可选，且校验刻意宽松：manifest 是作者可手编的文件，没有 id 的老项目必须照常打开。
  if (typeof o.id === 'string' && o.id.trim() !== '') meta.id = o.id
  return meta
}
