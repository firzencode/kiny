import { open, ask, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readDir, mkdir, exists, rename, remove, copyFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { join, dirname } from '@tauri-apps/api/path'
import { findManifest } from '@kiny/engine'
import type { ResolveAsset } from '@kiny/player'
import {
  type FileGateway, type LoadedProject, type Manifest, type ProjectFileEntry,
  STARTER_MAIN_KIN, STARTER_NEW_FILE, normalizeKinName, starterManifest, projectFileName, assertSafeRelPath,
} from './gateway'
import { type DraftStore, parseDraftStore, emptyDraftStore } from '../state/drafts'
import { type ChatStore, parseChatStore } from '../state/chatStore'
import { MEDIA_EXTS } from './importAssets'

// 自动保存草稿落 app-data（与项目目录隔离，不污染 git）；单文件存全部项目草稿。
const DRAFTS_DIR = 'autosave'
const DRAFTS_PATH = `${DRAFTS_DIR}/drafts.json`

// AI 对话历史落 app-data，一个项目一个文件（key = 项目路径 hash）。
const CHATS_DIR = 'ai-chats'
const chatPath = (key: string) => `${CHATS_DIR}/${key}.json`

async function pickDir(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

/**
 * 动态放行项目目录（含子树）给 plugin-fs 与 asset 协议，解锁任意盘符位置的项目
 * （不再受 capabilities 静态 `$HOME/**` 作用域限制）。读/写/新建某项目目录前调用。
 */
async function grantProjectScope(dir: string): Promise<void> {
  await invoke('allow_project_dir', { dir })
}

/** 递归扫 dir：收集全部文件相对路径与空目录相对路径。跳过所定位的 manifest 文件（不进资源树）。 */
async function scan(root: string, manifestFile: string): Promise<{ files: string[]; emptyDirs: string[] }> {
  const files: string[] = []
  const emptyDirs: string[] = []
  const walk = async (abs: string, rel: string): Promise<void> => {
    const ents = await readDir(abs)
    const kept = ents.filter((e) => !(e.isDirectory && (e.name.startsWith('.') || e.name === 'node_modules')))
    let childCount = 0
    for (const e of kept) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) { await walk(await join(abs, e.name), childRel); childCount++ }
      // 跳过所定位 manifest；另跳根部残留的旧 kiny.json（迁移后并存的边角，不进资源树，与 memoryGateway 一致）。
      else if (e.isFile && childRel !== manifestFile && childRel !== 'kiny.json') { files.push(childRel); childCount++ }
    }
    if (rel && childCount === 0) emptyDirs.push(rel)
  }
  await walk(root, '')
  return { files, emptyDirs }
}

async function readProject(dir: string): Promise<LoadedProject> {
  await grantProjectScope(dir) // 打开任意位置项目：先放行该目录再读盘
  const rootNames = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name)
  const found = findManifest(rootNames)
  if (!found.ok) throw new Error(found.message)
  let manifestFile = found.name
  const manifest = JSON.parse(await readTextFile(await join(dir, manifestFile))) as Manifest
  // 自动迁移：旧 kiny.json 项目（无 .kiw）→ 重命名为 <项目名>.kiw（rename 一步到位）。
  // 迁移失败（只读 / 锁定目录）不阻断打开——就地以 kiny.json 打开，仅本次不迁移。
  if (manifestFile === 'kiny.json') {
    const target = projectFileName(manifest.name)
    try {
      await rename(await join(dir, 'kiny.json'), await join(dir, target))
      manifestFile = target
    } catch {
      /* 保持 manifestFile = 'kiny.json'，只读旧项目仍可打开 */
    }
  }
  const { files: rels, emptyDirs } = await scan(dir, manifestFile)
  rels.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  emptyDirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const files: ProjectFileEntry[] = []
  for (const rel of rels) {
    const isKin = rel.endsWith('.kin')
    files.push(isKin ? { path: rel, isKin, source: await readTextFile(await join(dir, rel)) } : { path: rel, isKin })
  }
  if (!files.some((f) => f.path === manifest.entry)) throw new Error(`缺少入口文件 ${manifest.entry}`)
  return { dir, manifest, manifestFile, files, emptyDirs }
}

export const tauriFileGateway: FileGateway = {
  async pickProjectFile() {
    const picked = await open({
      multiple: false,
      filters: [
        { name: 'Kiny 项目', extensions: ['kiw'] },
        { name: 'Kiny 清单（旧）', extensions: ['json'] },
      ],
    })
    if (typeof picked !== 'string') return null
    return dirname(picked) // 项目根 = 所选文件的父目录
  },
  async newProject() {
    const dir = await pickDir()
    if (dir === null) return null
    await grantProjectScope(dir) // 新建项目也可能落在任意位置：写盘前先放行
    await writeTextFile(await join(dir, projectFileName('未命名项目')), JSON.stringify(starterManifest('未命名项目'), null, 2))
    await writeTextFile(await join(dir, 'main.kin'), STARTER_MAIN_KIN)
    // 不默认建 assets 目录——首次导入资源时按需创建（对齐 memoryGateway 行为）。
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
  async pickImportFiles() {
    const picked = await open({ multiple: true, filters: [{ name: '媒体资源', extensions: MEDIA_EXTS }] })
    if (picked === null) return null
    return Array.isArray(picked) ? picked : [picked]
  },
  async importAsset(dir, destRel, sourceAbsPath) {
    assertSafeRelPath(destRel)
    const absTo = await join(dir, destRel)
    if (destRel.includes('/')) {
      const parent = await join(dir, destRel.slice(0, destRel.lastIndexOf('/')))
      if (!(await exists(parent))) await mkdir(parent, { recursive: true })
    }
    await copyFile(sourceAbsPath, absTo)
  },
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
  async writeManifest(dir, manifest, manifestFile) {
    await writeTextFile(await join(dir, manifestFile), JSON.stringify(manifest, null, 2))
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
  async onOpenProjectFile(handler) {
    // single-instance（Rust 侧）解析出 .kiw 参数后 emit 此事件；payload 为文件绝对路径。
    return listen<string>('open-project-file', (e) => handler(e.payload))
  },
  async takeLaunchProject() {
    return invoke<string | null>('take_launch_project')
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
  async readChatStore(key): Promise<ChatStore | null> {
    try {
      const p = chatPath(key)
      if (!(await exists(p, { baseDir: BaseDirectory.AppData }))) return null
      return parseChatStore(await readTextFile(p, { baseDir: BaseDirectory.AppData }))
    } catch {
      return null
    }
  },
  async writeChatStore(key, store): Promise<void> {
    try {
      await mkdir(CHATS_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
      await writeTextFile(chatPath(key), JSON.stringify(store), { baseDir: BaseDirectory.AppData })
    } catch {
      /* 背景安全网：存储不可用时静默 */
    }
  },
  async deleteChatStore(key): Promise<void> {
    try {
      await remove(chatPath(key), { baseDir: BaseDirectory.AppData })
    } catch {
      /* 已不存在 / 不可用时静默 */
    }
  },
  async listChatStoreKeys(): Promise<string[]> {
    try {
      if (!(await exists(CHATS_DIR, { baseDir: BaseDirectory.AppData }))) return []
      const ents = await readDir(CHATS_DIR, { baseDir: BaseDirectory.AppData })
      return ents
        .filter((e) => e.isFile && e.name.endsWith('.json'))
        .map((e) => e.name.slice(0, -'.json'.length))
    } catch {
      return []
    }
  },
}
