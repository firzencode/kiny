// 资源导入的纯逻辑（无 React / gateway 依赖，便于单测）。
import { basename } from '../util/paths'
// basename 收敛到 util/paths；此处 re-export 保持既有 `import { basename } from './importAssets'` 调用点不变。
export { basename }

/** 图片扩展名（小写，不含点）。 */
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp']
/** 音频扩展名（小写，不含点）。bgm / se 只是指令引用路径的语义区别，与文件夹无关。 */
export const AUDIO_EXTS = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac']
/** 字体扩展名（小写，不含点）：放进项目即自动注册 `@font-face`，族名 = 文件名去扩展名。 */
export const FONT_EXTS = ['woff2', 'woff', 'ttf', 'otf']
/** 作品前端资源里可导入的文本类扩展名（css 主题等；js 本期只存放不执行）。 */
export const WEB_EXTS = ['css', 'js']
/** 合并的资源导入过滤器扩展名（图 / 音 / 字体 / css·js）。 */
export const MEDIA_EXTS = [...IMAGE_EXTS, ...AUDIO_EXTS, ...FONT_EXTS, ...WEB_EXTS]

/** 右键位置 → 导入目标目录（项目根相对；根 / 空白 = ''）。 */
export function resolveImportDir(kind: 'file' | 'dir' | 'root', path: string): string {
  if (kind === 'dir') return path
  if (kind === 'file') return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return '' // root
}

/** 目标相对路径 = 目录拼文件名（根目录则无前缀）。 */
export function destPath(dir: string, base: string): string {
  return dir ? `${dir}/${base}` : base
}

/**
 * 生成避开 taken 的唯一路径：在文件名 stem 后追加 `-1`/`-2`… 递增，保留扩展名。
 * taken 应含「现有文件 + 本批已导入」全部路径。destRel 不冲突时原样返回。
 */
export function uniqueName(destRel: string, taken: Set<string>): string {
  if (!taken.has(destRel)) return destRel
  const slash = destRel.lastIndexOf('/')
  const dir = slash >= 0 ? destRel.slice(0, slash + 1) : ''
  const file = slash >= 0 ? destRel.slice(slash + 1) : destRel
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  let i = 1
  let candidate = `${dir}${stem}-${i}${ext}`
  while (taken.has(candidate)) { i++; candidate = `${dir}${stem}-${i}${ext}` }
  return candidate
}
