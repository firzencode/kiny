import { validateManifest } from './manifest'
import { assembleProject } from './assemble'
import type { LoadResult } from './types'

/** 内存加载：从 manifest 文本 + 内存文件集装配项目。loadProject 去 fs 版，供 reader（Tauri fs/fetch）与 cli 复用。manifestName 是所定位的 manifest 文件名（`<项目名>.kiw` 或旧 kiny.json），供错误消息 / file 字段定位。 */
export function loadProjectFromFiles(
  manifestText: string,
  files: Map<string, string>,
  manifestName = 'kiny.json',
): LoadResult {
  let raw: unknown
  try {
    raw = JSON.parse(manifestText)
  } catch {
    return { ok: false, errors: [{ kind: 'manifest', message: `${manifestName} 不是合法 JSON`, file: manifestName }] }
  }
  const meta = validateManifest(raw, manifestName)
  if (Array.isArray(meta)) {
    return { ok: false, errors: meta.map((m) => ({ kind: 'manifest' as const, message: m, file: manifestName })) }
  }
  return assembleProject(meta, files, manifestName)
}
