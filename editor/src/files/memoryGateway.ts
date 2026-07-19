import { findManifest } from '@kiny/engine'
import type { ResolveAsset } from '@kiny/player'
import {
  type FileGateway, type LoadedProject, type Manifest, type ProjectFileEntry, type WindowMode,
  STARTER_MAIN_KIN, STARTER_NEW_FILE, normalizeKinName, starterManifest, projectFileName, projectFolderName, assertSafeRelPath, assertRenameSafe,
} from './gateway'
import { type DraftStore, emptyDraftStore } from '../state/drafts'
import type { ChatStore } from '../state/chatStore'

export interface MemoryGatewayInit {
  pickedDir?: string | null
  files: Record<string, string>          // 绝对键，如 '/p/chapters/a.kin'
  emptyDirs?: Record<string, string[]>   // dir → 相对空目录列表
  confirmResult?: boolean
  saveKipPath?: string | null
  exportSink?: { dest: string; files: string[] }[]
  webpageDir?: string | null
  webpageSink?: { dest: string; projectData: string; files: string[] }[]
  draftStore?: DraftStore
  chatStores?: Record<string, ChatStore>
  /** pickImportFiles 返回的注入列表（绝对路径）；缺省 null（视作取消）。 */
  importPicks?: string[] | null
  /** importAsset 调用记录（供断言）。 */
  importSink?: { dir: string; destRel: string; sourceAbsPath: string }[]
  /** pickProjectFile 返回的注入父目录；缺省 null（视作取消）。 */
  projectFilePick?: string | null
  /** onOpenProjectFile 注册的 handler 会被赋到此对象的 fire；测试可调 fire(path) 模拟 OS 双击 .kiw 打开事件。 */
  openFileHook?: { fire?: (path: string) => void }
  /** onWindowResize 注册的 handler 会被赋到此对象的 fire；测试可调 fire(w,h) 模拟用户拖拽调整窗口。 */
  resizeHook?: { fire?: (width: number, height: number) => void }
  /** takeLaunchProject 返回的冷启动待打开路径（取走后置空，模拟单次消费）；缺省 null。 */
  launchProject?: string | null
  /** pickDirectory 返回的注入父目录；缺省回退 pickedDir，再缺省 null。 */
  newParent?: string | null
  /** currentWindowMode 返回值（模拟 Tauri 窗口角色）；缺省 null（走 SPA 切换，web 行为）。 */
  windowMode?: WindowMode
  /** currentWindowProject 返回值（模拟编辑窗 URL ?project）；缺省 null。 */
  windowProject?: string | null
  /** 记录 openEditorWindow / openLaunchWindow / closeWindow 的调用序列（供窗口交接断言）。 */
  windowSink?: string[]
  /** 令 openEditorWindow / openLaunchWindow 抛错（模拟权限缺失 / 创建失败），验证交接不留空窗。 */
  windowOpenFails?: boolean
  /** currentMonitorSize 返回的屏幕逻辑分辨率（模拟 Tauri 显示器）；缺省 null（回落 LAUNCH_WINDOW）。 */
  monitorSize?: { width: number; height: number } | null
  /** 记录 setWindowSize 调用（供启动窗按分辨率定尺寸断言）。 */
  sizeSink?: { width: number; height: number }[]
}

/** 内存 FileGateway：纯 Map 支撑，前端逻辑可在 jsdom 全单测、不碰 Tauri。 */
export function createMemoryGateway(init: MemoryGatewayInit): FileGateway {
  const files = new Map(Object.entries(init.files))
  const emptyDirs = new Map(Object.entries(init.emptyDirs ?? {}))
  let draftStore: DraftStore = init.draftStore ?? emptyDraftStore()
  let launchProject: string | null = init.launchProject ?? null
  const chatStores = new Map(Object.entries(init.chatStores ?? {}))

  /** 列 dir 下全部文件（递归，排除 manifest：kiny.json 与任意 .kiw），返回相对路径升序。 */
  const listAll = (dir: string): string[] => {
    const prefix = `${dir}/`
    const out: string[] = []
    for (const abs of files.keys()) {
      if (!abs.startsWith(prefix)) continue
      const rel = abs.slice(prefix.length)
      if (rel === 'kiny.json' || rel.endsWith('.kiw')) continue
      out.push(rel)
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  /** dir 根部文件名（非递归），供 findManifest 定位 manifest。 */
  const rootNames = (dir: string): string[] => {
    const prefix = `${dir}/`
    return [...files.keys()]
      .filter((abs) => abs.startsWith(prefix))
      .map((abs) => abs.slice(prefix.length))
      .filter((rel) => !rel.includes('/'))
  }

  const readProject = async (dir: string): Promise<LoadedProject> => {
    const found = findManifest(rootNames(dir))
    if (!found.ok) throw new Error(found.message)
    let manifestFile = found.name
    const manifest = JSON.parse(files.get(`${dir}/${manifestFile}`)!) as Manifest
    // 自动迁移：旧 kiny.json 项目 → 重命名为 <项目名>.kiw（内存里迁移 key）。
    if (manifestFile === 'kiny.json') {
      const target = projectFileName(manifest.name)
      files.set(`${dir}/${target}`, files.get(`${dir}/kiny.json`)!)
      files.delete(`${dir}/kiny.json`)
      manifestFile = target
    }
    const rels = listAll(dir)
    const projFiles: ProjectFileEntry[] = rels.map((rel) => {
      const isKin = rel.endsWith('.kin')
      return isKin
        ? { path: rel, isKin, source: files.get(`${dir}/${rel}`)! }
        : { path: rel, isKin, source: undefined }
    })
    if (!projFiles.some((f) => f.path === manifest.entry)) throw new Error(`缺少入口文件 ${manifest.entry}`)
    return { dir, manifest, manifestFile, files: projFiles, emptyDirs: emptyDirs.get(dir) ?? [] }
  }

  return {
    // 未显式注入 projectFilePick 时回退 pickedDir（指向项目根目录，便于既有测试沿用）。
    pickProjectFile: async () => init.projectFilePick ?? init.pickedDir ?? null,
    pickDirectory: async () => init.newParent ?? init.pickedDir ?? null,
    newProject: async (parentDir, name) => {
      const folder = projectFolderName(name)
      const dir = `${parentDir}/${folder}`
      if ([...files.keys()].some((k) => k.startsWith(`${dir}/`))) {
        throw new Error(`目标位置已存在「${folder}」，无法创建`)
      }
      files.set(`${dir}/${projectFileName(name)}`, JSON.stringify(starterManifest(name), null, 2))
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
    writeFile: async (dir, rel, text) => { assertSafeRelPath(rel); files.set(`${dir}/${rel}`, text) },
    pickImportFiles: async () => init.importPicks ?? null,
    importAsset: async (dir, destRel, sourceAbsPath) => {
      assertSafeRelPath(destRel)
      init.importSink?.push({ dir, destRel, sourceAbsPath })
      files.set(`${dir}/${destRel}`, `<binary:${sourceAbsPath}>`)
    },
    makeResolveAsset: (_dir): ResolveAsset => (rel) => `mem://${rel}`,
    createFolder: async (dir, relDir) => {
      assertSafeRelPath(relDir)
      const list = emptyDirs.get(dir) ?? []
      if (!list.includes(relDir)) emptyDirs.set(dir, [...list, relDir])
    },
    renamePath: async (dir, from, to) => {
      assertRenameSafe(from, to)
      const absFrom = `${dir}/${from}`, absTo = `${dir}/${to}`
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
      assertSafeRelPath(relPath)
      const abs = `${dir}/${relPath}`
      files.delete(abs)
      const prefix = `${abs}/`
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k)
      const list = emptyDirs.get(dir) ?? []
      emptyDirs.set(dir, list.filter((d) => d !== relPath && !d.startsWith(`${relPath}/`)))
    },
    writeManifest: async (dir, manifest, manifestFile) => { assertSafeRelPath(manifestFile); files.set(`${dir}/${manifestFile}`, JSON.stringify(manifest, null, 2)) },
    pickSaveKipPath: async () => init.saveKipPath ?? null,
    exportKip: async (dir, dest) => {
      if (!findManifest(rootNames(dir)).ok) throw new Error(`缺少 manifest: ${dir}`)
      init.exportSink?.push({ dest, files: listAll(dir) })
    },
    pickExportWebpageDir: async () => init.webpageDir ?? null,
    exportWebpage: async (projectDir, parentDir, folderName, projectData) => {
      if (!findManifest(rootNames(projectDir)).ok) throw new Error(`缺少 manifest: ${projectDir}`)
      const dest = `${parentDir}/${folderName}`
      init.webpageSink?.push({ dest, projectData, files: listAll(projectDir) })
      return dest
    },
    confirm: async () => init.confirmResult ?? true,
    closeWindow: async () => { init.windowSink?.push('close') },
    openEditorWindow: async (projectDir) => {
      if (init.windowOpenFails) { init.windowSink?.push('openEditor:FAIL'); throw new Error('模拟创建编辑窗失败') }
      init.windowSink?.push(`openEditor:${projectDir}`)
    },
    openLaunchWindow: async () => {
      if (init.windowOpenFails) { init.windowSink?.push('openLaunch:FAIL'); throw new Error('模拟创建启动窗失败') }
      init.windowSink?.push('openLaunch')
    },
    currentWindowMode: () => init.windowMode ?? null,
    currentWindowProject: () => init.windowProject ?? null,
    currentMonitorSize: async () => init.monitorSize ?? null,
    setWindowSize: async (width, height) => { init.sizeSink?.push({ width, height }) },
    onWindowResize: async (handler) => {
      if (init.resizeHook) init.resizeHook.fire = handler
      return () => { if (init.resizeHook) init.resizeHook.fire = undefined }
    },
    onWindowCloseRequest: async () => () => { /* 内存桩：永不回调 */ },
    onOpenProjectFile: async (handler) => {
      if (init.openFileHook) init.openFileHook.fire = handler
      return () => { if (init.openFileHook) init.openFileHook.fire = undefined }
    },
    takeLaunchProject: async () => { const p = launchProject; launchProject = null; return p },
    readDraftStore: async () => structuredClone(draftStore),
    writeDraftStore: async (store) => { draftStore = structuredClone(store) },
    readChatStore: async (key) => (chatStores.has(key) ? structuredClone(chatStores.get(key)!) : null),
    writeChatStore: async (key, store) => { chatStores.set(key, structuredClone(store)) },
    deleteChatStore: async (key) => { chatStores.delete(key) },
    listChatStoreKeys: async () => [...chatStores.keys()],
  }
}
