import { validateManifest } from './manifest'
import { assembleProject } from './assemble'
import type { LoadResult } from './types'

/** 内存加载：从 kiny.json 文本 + 内存文件集装配项目。loadProject 去 fs 版，供 reader（Tauri fs/fetch）与 cli 复用。 */
export function loadProjectFromFiles(manifestText: string, files: Map<string, string>): LoadResult {
  let raw: unknown
  try {
    raw = JSON.parse(manifestText)
  } catch {
    return { ok: false, errors: [{ kind: 'manifest', message: 'kiny.json 不是合法 JSON', file: 'kiny.json' }] }
  }
  const meta = validateManifest(raw)
  if (Array.isArray(meta)) {
    return { ok: false, errors: meta.map((m) => ({ kind: 'manifest' as const, message: m, file: 'kiny.json' })) }
  }
  return assembleProject(meta, files)
}
