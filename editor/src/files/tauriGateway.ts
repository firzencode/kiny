import { open, ask, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir, mkdir, exists, rename, remove, BaseDirectory } from '@tauri-apps/plugin-fs'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { join } from '@tauri-apps/api/path'
import type { ResolveAsset } from '@kiny/player'
import {
  type FileGateway, type LoadedProject, type Manifest, type ProjectFileEntry,
  STARTER_MAIN_KIN, STARTER_NEW_FILE, normalizeKinName, starterManifest, assertSafeRelPath,
} from './gateway'
import { type DraftStore, parseDraftStore, emptyDraftStore } from '../state/drafts'

// 自动保存草稿落 app-data（与项目目录隔离，不污染 git）；单文件存全部项目草稿。
const DRAFTS_DIR = 'autosave'
const DRAFTS_PATH = `${DRAFTS_DIR}/drafts.json`

async function pickDir(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

/** 递归扫 dir：收集全部文件相对路径与空目录相对路径。 */
async function scan(root: string): Promise<{ files: string[]; emptyDirs: string[] }> {
  const files: string[] = []
  const emptyDirs: string[] = []
  const walk = async (abs: string, rel: string): Promise<void> => {
    const ents = await readDir(abs)
    const kept = ents.filter((e) => !(e.isDirectory && (e.name.startsWith('.') || e.name === 'node_modules')))
    let childCount = 0
    for (const e of kept) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) { await walk(await join(abs, e.name), childRel); childCount++ }
      else if (e.isFile && childRel !== 'kiny.json') { files.push(childRel); childCount++ }
    }
    if (rel && childCount === 0) emptyDirs.push(rel)
  }
  await walk(root, '')
  return { files, emptyDirs }
}

async function readProject(dir: string): Promise<LoadedProject> {
  const manifest = JSON.parse(await readTextFile(await join(dir, 'kiny.json'))) as Manifest
  const { files: rels, emptyDirs } = await scan(dir)
  rels.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  emptyDirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const files: ProjectFileEntry[] = []
  for (const rel of rels) {
    const isKin = rel.endsWith('.kin')
    files.push(isKin ? { path: rel, isKin, source: await readTextFile(await join(dir, rel)) } : { path: rel, isKin })
  }
  if (!files.some((f) => f.path === manifest.entry)) throw new Error(`缺少入口文件 ${manifest.entry}`)
  return { dir, manifest, files, emptyDirs }
}

export const tauriFileGateway: FileGateway = {
  pickProjectDir: pickDir,
  async newProject() {
    const dir = await pickDir()
    if (dir === null) return null
    await writeTextFile(await join(dir, 'kiny.json'), JSON.stringify(starterManifest('未命名项目'), null, 2))
    await writeTextFile(await join(dir, 'main.kin'), STARTER_MAIN_KIN)
    const assetsDir = await join(dir, 'assets')
    if (!(await exists(assetsDir))) await mkdir(assetsDir)
    return dir
  },
  readProject,
  async createFile(dir, rawPath) {
    const rel = normalizeKinName(rawPath)
    const abs = await join(dir, rel)
    if (await exists(abs)) throw new Error(`文件已存在: ${rel}`)
    const parent = rel.includes('/') ? await join(dir, rel.slice(0, rel.lastIndexOf('/'))) : dir
    if (!(await exists(parent))) await mkdir(parent, { recursive: true })
    await writeTextFile(abs, STARTER_NEW_FILE)
    return { path: rel, isKin: true, source: STARTER_NEW_FILE }
  },
  writeFile: async (dir, rel, text) => { await writeTextFile(await join(dir, rel), text) },
  makeResolveAsset(dir: string): ResolveAsset {
    return (rel) => convertFileSrc(`${dir}/${rel}`)
  },
  async createFolder(dir, relDir) {
    assertSafeRelPath(relDir)
    await mkdir(await join(dir, relDir), { recursive: true })
  },
  async renamePath(dir, from, to) {
    assertSafeRelPath(from)
    assertSafeRelPath(to)
    if (to === from || to.startsWith(`${from}/`)) throw new Error(`不能移入自身: ${to}`)
    const absTo = await join(dir, to)
    if (await exists(absTo)) throw new Error(`目标已存在: ${to}`)
    if (to.includes('/')) {
      const parent = await join(dir, to.slice(0, to.lastIndexOf('/')))
      if (!(await exists(parent))) await mkdir(parent, { recursive: true })
    }
    await rename(await join(dir, from), absTo)
  },
  async deletePath(dir, relPath) {
    await remove(await join(dir, relPath), { recursive: true })
  },
  async writeManifest(dir, manifest) {
    await writeTextFile(await join(dir, 'kiny.json'), JSON.stringify(manifest, null, 2))
  },
  async pickSaveKipPath(defaultName) {
    const picked = await save({ defaultPath: defaultName, filters: [{ name: 'Kiny 故事包', extensions: ['kip'] }] })
    return picked ?? null
  },
  async exportKip(dir, destPath) {
    await invoke('export_kip', { dir, dest: destPath })
  },
  async pickExportWebpageDir() {
    const picked = await open({ directory: true, multiple: false })
    return typeof picked === 'string' ? picked : null
  },
  async exportWebpage(projectDir, parentDir, folderName, projectData) {
    return invoke<string>('export_webpage', { projectDir, parentDir, folderName, projectData })
  },
  async confirm(message) {
    return ask(message, { title: 'Kiny Editor', kind: 'warning' })
  },
  async closeWindow() {
    // destroy（非 close）：不再触发 onCloseRequested，避免守卫死循环
    await getCurrentWindow().destroy()
  },
  async onWindowCloseRequest(handler) {
    return getCurrentWindow().onCloseRequested((e) => {
      e.preventDefault()
      handler()
    })
  },
  async readDraftStore(): Promise<DraftStore> {
    try {
      if (!(await exists(DRAFTS_PATH, { baseDir: BaseDirectory.AppData }))) return emptyDraftStore()
      return parseDraftStore(await readTextFile(DRAFTS_PATH, { baseDir: BaseDirectory.AppData }))
    } catch {
      return emptyDraftStore()
    }
  },
  async writeDraftStore(store): Promise<void> {
    try {
      await mkdir(DRAFTS_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
      await writeTextFile(DRAFTS_PATH, JSON.stringify(store), { baseDir: BaseDirectory.AppData })
    } catch {
      /* 背景安全网：存储不可用时静默，不打断编辑 */
    }
  },
}
