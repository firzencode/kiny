import type { KinyMeta } from './types'

/** 校验 kiny.json：四字段须为非空字符串；合法返回 KinyMeta，否则返回错误消息数组（一次报全）。 */
export function validateManifest(raw: unknown): KinyMeta | string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['kiny.json 不是 JSON 对象']
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
  return { name: o.name as string, version: o.version as string, engine: o.engine as string, entry: o.entry as string }
}
