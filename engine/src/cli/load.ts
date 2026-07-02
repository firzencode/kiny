import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { loadProjectFromFiles, findManifest } from '../index'
import type { LoadResult } from '../index'

/** 递归扫描 rootDir 下所有 *.kin（跳过 . 开头目录与 node_modules），key 为相对 rootDir、/ 分隔的归一路径。 */
function scanKin(rootDir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile() && ent.name.endsWith('.kin')) {
        const norm = relative(rootDir, full).split(sep).join('/')
        out.set(norm, readFileSync(full, 'utf8'))
      }
    }
  }
  walk(rootDir)
  return out
}

/** 加载一个标准 Kiny 项目目录：列根 → findManifest 定位 `<名>.kiw`（或旧 kiny.json）→ 读之 → 扫 .kin → 内存装配（cli 专属，唯一 fs 触点）。 */
export function loadProject(rootDir: string): LoadResult {
  let rootNames: string[]
  try {
    rootNames = readdirSync(rootDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return { ok: false, errors: [{ kind: 'io', message: `无法读取项目目录: ${rootDir}`, file: rootDir }] }
  }
  const found = findManifest(rootNames)
  if (!found.ok) {
    return { ok: false, errors: [{ kind: 'io', message: `${found.message}，这不是一个 Kiny 项目`, file: rootDir }] }
  }
  let rawText: string
  try {
    rawText = readFileSync(join(rootDir, found.name), 'utf8')
  } catch {
    return { ok: false, errors: [{ kind: 'io', message: `无法读取 ${found.name}`, file: found.name }] }
  }
  return loadProjectFromFiles(rawText, scanKin(rootDir), found.name)
}
