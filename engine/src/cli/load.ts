import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { loadProjectFromFiles } from '../index'
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

/** 加载一个标准 Kiny 项目目录：读 kiny.json → 扫 .kin → 内存装配（cli 专属，唯一 fs 触点）。 */
export function loadProject(rootDir: string): LoadResult {
  let rawText: string
  try {
    rawText = readFileSync(join(rootDir, 'kiny.json'), 'utf8')
  } catch {
    return { ok: false, errors: [{ kind: 'io', message: '缺少 kiny.json，这不是一个 Kiny 项目', file: 'kiny.json' }] }
  }
  return loadProjectFromFiles(rawText, scanKin(rootDir))
}
