// 媒体资源的类型分派（纯函数，无 React / gateway 依赖，便于单测）。
import { IMAGE_EXTS, AUDIO_EXTS } from './importAssets'

/** 可在编辑区开 tab 预览的媒体类型。字体不在其列（需另设计样张）。 */
export type MediaKind = 'image' | 'audio'

/** 末段扩展名（小写、不含点）；无扩展名或以点开头的文件名返回空串。 */
function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

/**
 * 按扩展名判媒体类型；非媒体（文本 / 字体 / 未知）返回 null。
 * 扩展名表复用导入过滤器的 IMAGE_EXTS / AUDIO_EXTS——「能导入的格式」与「能预览的格式」同一份真相源。
 */
export function mediaKind(path: string): MediaKind | null {
  const ext = extOf(path)
  if (ext === '') return null
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  return null
}
