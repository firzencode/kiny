import type { ResolveAsset } from '@kiny/player'
import {
  type FileGateway, type LoadedProject, type Manifest, type ProjectFileEntry,
  STARTER_MAIN_KIN, STARTER_NEW_FILE, normalizeKinName, starterManifest, assertSafeRelPath,
} from './gateway'

export interface MemoryGatewayInit {
  pickedDir?: string | null
  newDir?: string | null
  files: Record<string, string>          // 绝对键，如 '/p/chapters/a.kin'
  emptyDirs?: Record<string, string[]>   // dir → 相对空目录列表
  confirmResult?: boolean
  saveKipPath?: string | null
  exportSink?: { dest: string; files: string[] }[]
  webpageDir?: string | null
  webpageSink?: { dest: string; projectData: string; files: string[] }[]
}

/** 内存 FileGateway：纯 Map 支撑，前端逻辑可在 jsdom 全单测、不碰 Tauri。 */
export function createMemoryGateway(init: MemoryGatewayInit): FileGateway {
  const files = new Map(Object.entries(init.files))
  const emptyDirs = new Map(Object.entries(init.emptyDirs ?? {}))

  /** 列 dir 下全部文件（递归，排除 kiny.json），返回相对路径升序。 */
  const listAll = (dir: string): string[] => {
    const prefix = `${dir}/`
    const out: string[] = []
    for (const abs of files.keys()) {
      if (!abs.startsWith(prefix)) continue
      const rel = abs.slice(prefix.length)
      if (rel === 'kiny.json') continue
      out.push(rel)
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  const readProject = async (dir: string): Promise<LoadedProject> => {
    const manifestText = files.get(`${dir}/kiny.json`)
    if (manifestText === undefined) throw new Error(`缺少 ${dir}/kiny.json`)
    const manifest = JSON.parse(manifestText) as Manifest
    const rels = listAll(dir)
    const projFiles: ProjectFileEntry[] = rels.map((rel) => {
      const isKin = rel.endsWith('.kin')
      return isKin
        ? { path: rel, isKin, source: files.get(`${dir}/${rel}`)! }
        : { path: rel, isKin, source: undefined }
    })
    if (!projFiles.some((f) => f.path === manifest.entry)) throw new Error(`缺少入口文件 ${manifest.entry}`)
    return { dir, manifest, files: projFiles, emptyDirs: emptyDirs.get(dir) ?? [] }
  }

  return {
    pickProjectDir: async () => init.pickedDir ?? null,
    newProject: async () => {
      const dir = init.newDir ?? null
      if (dir === null) return null
      files.set(`${dir}/kiny.json`, JSON.stringify(starterManifest('未命名项目'), null, 2))
      files.set(`${dir}/main.kin`, STARTER_MAIN_KIN)
      return dir
    },
    readProject,
    createFile: async (dir, rawPath) => {
      const rel = normalizeKinName(rawPath)
      const abs = `${dir}/${rel}`
      if (files.has(abs)) throw new Error(`文件已存在: ${rel}`)
      files.set(abs, STARTER_NEW_FILE)
      return { path: rel, isKin: true, source: STARTER_NEW_FILE }
    },
    writeFile: async (dir, rel, text) => { files.set(`${dir}/${rel}`, text) },
    makeResolveAsset: (_dir): ResolveAsset => (rel) => `mem://${rel}`,
    createFolder: async (dir, relDir) => {
      assertSafeRelPath(relDir)
      const list = emptyDirs.get(dir) ?? []
      if (!list.includes(relDir)) emptyDirs.set(dir, [...list, relDir])
    },
    renamePath: async (dir, from, to) => {
      assertSafeRelPath(from)
      assertSafeRelPath(to)
      const absFrom = `${dir}/${from}`, absTo = `${dir}/${to}`
      if (absTo === absFrom || absTo.startsWith(`${absFrom}/`)) throw new Error(`不能移入自身: ${to}`)
      if (files.has(absTo) || [...files.keys()].some((k) => k.startsWith(`${absTo}/`))) throw new Error(`目标已存在: ${to}`)
      if (files.has(absFrom)) { files.set(absTo, files.get(absFrom)!); files.delete(absFrom); return }
      // 目录：前缀迁移文件 + emptyDirs
      const prefix = `${absFrom}/`
      for (const abs of [...files.keys()]) {
        if (abs.startsWith(prefix)) { files.set(`${absTo}/${abs.slice(prefix.length)}`, files.get(abs)!); files.delete(abs) }
      }
      const list = emptyDirs.get(dir) ?? []
      emptyDirs.set(dir, list.map((d) => (d === from ? to : d.startsWith(`${from}/`) ? to + d.slice(from.length) : d)))
    },
    deletePath: async (dir, relPath) => {
      const abs = `${dir}/${relPath}`
      files.delete(abs)
      const prefix = `${abs}/`
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k)
      const list = emptyDirs.get(dir) ?? []
      emptyDirs.set(dir, list.filter((d) => d !== relPath && !d.startsWith(`${relPath}/`)))
    },
    writeManifest: async (dir, manifest) => { files.set(`${dir}/kiny.json`, JSON.stringify(manifest, null, 2)) },
    pickSaveKipPath: async () => init.saveKipPath ?? null,
    exportKip: async (dir, dest) => {
      if (!files.has(`${dir}/kiny.json`)) throw new Error(`缺少 ${dir}/kiny.json`)
      init.exportSink?.push({ dest, files: listAll(dir) })
    },
    pickExportWebpageDir: async () => init.webpageDir ?? null,
    exportWebpage: async (projectDir, parentDir, folderName, projectData) => {
      if (!files.has(`${projectDir}/kiny.json`)) throw new Error(`缺少 ${projectDir}/kiny.json`)
      const dest = `${parentDir}/${folderName}`
      init.webpageSink?.push({ dest, projectData, files: listAll(projectDir) })
      return dest
    },
    confirm: async () => init.confirmResult ?? true,
    closeWindow: async () => { /* 内存桩：无窗口可关 */ },
    onWindowCloseRequest: async () => () => { /* 内存桩：永不回调 */ },
  }
}
