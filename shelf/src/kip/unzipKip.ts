import { unzipSync, strFromU8 } from 'fflate'
import { findManifest } from '@kiny/engine'

export interface UnzippedKip {
  manifestName: string
  manifestText: string
  /** 相对路径 → UTF-8 文本（engine 只吃文本）。 */
  kinFiles: Map<string, string>
  /** 资源名（项目根相对全路径，如 `assets/x.png`）→ Blob（含 MIME 猜测）。 */
  assets: Map<string, Blob>
  /** `.css` 的 UTF-8 文本（作品主题需文本才能重写 `url()`；同一文件亦留在 assets 里）。 */
  cssFiles: Map<string, string>
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  // 前端资源：字体 objectURL 需正确 MIME 才被浏览器当字体加载。
  css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
}
function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? ''
}

/**
 * 浏览器端解压 `.kip`（zip 根部直接是 manifest + `.kin` + 资源）。
 * 目录条目（末尾 `/`）与任意路径段以 `.` 开头的隐藏项跳过（镜像 reader 打包侧规则）。
 * 非法 zip（fflate 抛错）/ 缺 manifest（无 `.kiw` 亦无 `kiny.json`）→ 抛 Error，交调用方兜底。
 */
export function unzipKip(bytes: Uint8Array): UnzippedKip {
  const entries = unzipSync(bytes) // 非法字节在此抛错
  const names = Object.keys(entries).filter(
    (n) => !n.endsWith('/') && !n.split('/').some((seg) => seg.startsWith('.')),
  )
  const rootNames = names.filter((n) => !n.includes('/')) // manifest 位于 zip 根
  const found = findManifest(rootNames)
  if (!found.ok) throw new Error(found.message)

  const manifestName = found.name
  const manifestText = strFromU8(entries[manifestName]!)
  const kinFiles = new Map<string, string>()
  const assets = new Map<string, Blob>()
  const cssFiles = new Map<string, string>()
  for (const name of names) {
    if (name === manifestName) continue
    const data = entries[name]!
    if (name.endsWith('.kin')) {
      kinFiles.set(name, strFromU8(data))
      continue
    }
    assets.set(name, new Blob([data], { type: mimeOf(name) }))
    if (name.toLowerCase().endsWith('.css')) cssFiles.set(name, strFromU8(data))
  }
  return { manifestName, manifestText, kinFiles, assets, cssFiles }
}
