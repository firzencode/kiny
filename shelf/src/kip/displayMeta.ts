/** manifest（kiny.json）里给书架展示用的字段。engine 的 KinyMeta 只暴露 name/version/engine/entry，
 * author/cover/description 是可选扩展字段，须自行从 JSON 读取（cover 是资源名，如 `assets/c.jpg`）。 */
export interface DisplayMeta {
  name: string
  author?: string
  cover?: string
  description?: string
}

/** 解析 manifest 文本取展示字段。非 JSON 对象 / 缺 name → 抛错（调用方在装配校验后调用，通常已合法）。 */
export function readDisplayMeta(manifestText: string): DisplayMeta {
  const v: unknown = JSON.parse(manifestText)
  if (!v || typeof v !== 'object') throw new Error('manifest 不是 JSON 对象')
  const o = v as Record<string, unknown>
  const str = (k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
  const name = str('name')
  if (!name) throw new Error('manifest 缺少 name 字段')
  return { name, author: str('author'), cover: str('cover'), description: str('description') }
}
