import type { ProjectFile } from '../parser/ast'

/** kiny.json 的四个必需字段（spec §1.1），外加可选的作品稳定标识。 */
export interface KinyMeta {
  name: string
  version: string
  engine: string
  entry: string
  /** 作品稳定标识（可选）。按作品分桶的场景（如导出网页的读者存档）用它，而非会重名、会被作者改动的 name。 */
  id?: string
}

/** 加载期错误：manifest 校验 / 解析 / IO，带可选源定位。 */
export interface ProjectError {
  kind: 'manifest' | 'parse' | 'io'
  message: string
  file?: string
  line?: number
}

export type LoadResult =
  | { ok: true; files: ProjectFile[]; entry: string; meta: KinyMeta }
  | { ok: false; errors: ProjectError[] }
