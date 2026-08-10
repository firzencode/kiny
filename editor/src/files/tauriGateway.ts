import { open, ask, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readFile, readDir, mkdir, exists, rename, remove, copyFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, currentMonitor, LogicalSize } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen } from '@tauri-apps/api/event'
import { join, dirname } from '@tauri-apps/api/path'
import { findManifest } from '@kiny/engine'
import type { ResolveAsset } from '@kiny/player'
import {
  type FileGateway, type LoadedProject, type Manifest, type ProjectFileEntry, type WindowMode,
  STARTER_MAIN_KIN, STARTER_THEME_CSS, normalizeNewFileName, starterContentFor, isKinFile, starterManifest, projectFileName, projectFolderName, assertSafeRelPath, assertRenameSafe, isTextFile,
} from './gateway'
import { loadWorkbenchSize, computeLaunchSize, LAUNCH_WINDOW, WORKBENCH_WINDOW, WORKBENCH_MIN_SIZE } from '../state/windowSize'
import { type DraftStore, parseDraftStore, emptyDraftStore } from '../state/drafts'
import { type ChatStore, parseChatStore } from '../state/chatStore'
import { MEDIA_EXTS } from './importAssets'

// 自动保存草稿落 app-data（与项目目录隔离，不污染 git）；单文件存全部项目草稿。
const DRAFTS_DIR = 'autosave'
const DRAFTS_PATH = `${DRAFTS_DIR}/drafts.json`

// AI 对话历史落 app-data，一个项目一个文件（key = 项目路径 hash）。
const CHATS_DIR = 'ai-chats'
const chatPath = (key: string) => `${CHATS_DIR}/${key}.json`

// 外部控制信息落 app-data（T040）：CLI/skill 按同一路径发现端口 + token，identifier 见 tauri.conf.json。

/** 二进制资源的 data-URI MIME（导出网页内联字体用；未知扩展名交浏览器嗅探）。 */
const DATA_URI_MIME: Record<string, string> = {
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
}
function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return DATA_URI_MIME[ext] ?? 'application/octet-stream'
}
/** 字节 → base64。分块喂 btoa：字体动辄数 MB，一次性 spread 会爆调用栈。 */
function base64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function pickDir(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

/**
 * spawn 一个 label 已知的 WebviewWindow 并**等待创建完成**（成功 resolve / 失败 reject）。
 * 构造函数本身不抛错——失败经 `tauri://error` 事件回报；等到 created 再返回，让调用方
 * 能先确认新窗已起再关旧窗（互斥交接不留空窗），失败也能弹 notice 而非静默。
 */
function spawnWindow(
  label: 'launch' | 'editor',
  opts: { url: string; width: number; height: number; minWidth?: number; minHeight?: number; resizable?: boolean; maximizable?: boolean },
): Promise<void> {
  const w = new WebviewWindow(label, {
    url: opts.url,
    title: 'Kiny Editor',
    width: opts.width, height: opts.height,
    minWidth: opts.minWidth, minHeight: opts.minHeight,
    center: true,
    resizable: opts.resizable ?? true,
    maximizable: opts.maximizable ?? true,
  })
  return new Promise<void>((resolve, reject) => {
    void w.once('tauri://created', () => resolve())
    void w.once('tauri://error', (e) => reject(new Error(`创建窗口失败：${String(e.payload)}`)))
  })
}

/** 当前显示器逻辑分辨率（物理尺寸 / 缩放因子）；取不到 → null。启动窗按屏分辨率定尺寸用。 */
async function monitorLogicalSize(): Promise<{ width: number; height: number } | null> {
  const m = await currentMonitor()
  if (!m) return null
  const scale = m.scaleFactor || 1
  return { width: Math.round(m.size.width / scale), height: Math.round(m.size.height / scale) }
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
    const isKin = isKinFile(rel)
    // 文本文件（.kin + css/js/json/txt/md/html）载入文本供编辑；二进制只列名。
    // 读不出文本（非 UTF-8 的 .txt/.json 在中文环境里很常见）时降级成「只列名」——
    // 一个编码异常的旁挂文件不该让整个项目打不开；`.kin` 例外，它读不了就是真错误。
    let source: string | undefined
    if (isTextFile(rel)) {
      try {
        source = await readTextFile(await join(dir, rel))
      } catch (e) {
        if (isKin) throw e
      }
    }
    files.push(source !== undefined ? { path: rel, isKin, source } : { path: rel, isKin })
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
  pickDirectory: pickDir,
  async newProject(parentDir, name) {
    const folder = projectFolderName(name)
    const dir = await join(parentDir, folder)
    await grantProjectScope(parentDir) // 触及 dir 前先放行父目录树（递归覆盖子路径），任意盘符位置需要
    // 不覆盖：exists 预检给友好文案；非递归 mkdir 作竞态兜底屏障（exists 与 mkdir 之间的极小窗口也转同一文案）。
    if (await exists(dir)) throw new Error(`目标位置已存在「${folder}」，无法创建`)
    try {
      await mkdir(dir) // 非递归：目标已存在即抛错
    } catch {
      throw new Error(`目标位置已存在「${folder}」，无法创建`)
    }
    await writeTextFile(await join(dir, projectFileName(name)), JSON.stringify(starterManifest(name), null, 2))
    await writeTextFile(await join(dir, 'main.kin'), STARTER_MAIN_KIN)
    // 内置主题文件：作者打开自己的项目即看见「外观可改」，无需先去翻样例或教程。
    await writeTextFile(await join(dir, 'theme.css'), STARTER_THEME_CSS)
    // 不默认建 assets 目录——首次导入资源时按需创建。
    return dir
  },
  readProject,
  async createFile(dir, rawPath) {
    const rel = normalizeNewFileName(rawPath)
    const abs = await join(dir, rel)
    if (await exists(abs)) throw new Error(`文件已存在: ${rel}`)
    const parent = rel.includes('/') ? await join(dir, rel.slice(0, rel.lastIndexOf('/'))) : dir
    if (!(await exists(parent))) await mkdir(parent, { recursive: true })
    const source = starterContentFor(rel)
    await writeTextFile(abs, source)
    return { path: rel, isKin: isKinFile(rel), source }
  },
  writeFile: async (dir, rel, text) => {
    assertSafeRelPath(rel)
    await writeTextFile(await join(dir, rel), text)
  },
  readTextFile: async (dir, rel) => {
    assertSafeRelPath(rel)
    return readTextFile(await join(dir, rel))
  },
  async pickImportFiles() {
    const picked = await open({ multiple: true, filters: [{ name: '作品资源（图 / 音 / 字体 / css）', extensions: MEDIA_EXTS }] })
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
  async readAssetDataUri(dir, rel) {
    assertSafeRelPath(rel)
    const bytes = await readFile(await join(dir, rel))
    return `data:${mimeOf(rel)};base64,${base64(bytes)}`
  },
  async createFolder(dir, relDir) {
    assertSafeRelPath(relDir)
    await mkdir(await join(dir, relDir), { recursive: true })
  },
  async renamePath(dir, from, to) {
    assertRenameSafe(from, to)
    const absTo = await join(dir, to)
    if (await exists(absTo)) throw new Error(`目标已存在: ${to}`)
    if (to.includes('/')) {
      const parent = await join(dir, to.slice(0, to.lastIndexOf('/')))
      if (!(await exists(parent))) await mkdir(parent, { recursive: true })
    }
    await rename(await join(dir, from), absTo)
  },
  async deletePath(dir, relPath) {
    assertSafeRelPath(relPath)
    await remove(await join(dir, relPath), { recursive: true })
  },
  async writeManifest(dir, manifest, manifestFile) {
    assertSafeRelPath(manifestFile)
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
  async exportThemeFile(defaultName, contents) {
    const picked = await save({ defaultPath: defaultName, filters: [{ name: 'Kiny 主题', extensions: ['json'] }] })
    if (typeof picked !== 'string') return false
    await grantProjectScope(await dirname(picked)) // 动态放行目标目录，任意盘符位置也可写（同项目目录放行套路）
    await writeTextFile(picked, contents)
    return true
  },
  async confirm(message) {
    return ask(message, { title: 'Kiny Editor', kind: 'warning' })
  },
  async closeWindow() {
    // destroy（非 close）：不再触发 onCloseRequested，避免守卫死循环
    await getCurrentWindow().destroy()
  },
  async openEditorWindow(projectDir) {
    // 编辑窗初始尺寸优先用记忆的 workbench 尺寸（用户上次手动调整的），未记过用默认。
    const size = loadWorkbenchSize() ?? WORKBENCH_WINDOW
    await spawnWindow('editor', {
      url: `index.html?project=${encodeURIComponent(projectDir)}`,
      width: size.width, height: size.height,
      minWidth: WORKBENCH_MIN_SIZE.width, minHeight: WORKBENCH_MIN_SIZE.height,
    })
  },
  async openLaunchWindow() {
    // 启动窗按屏幕分辨率定固定尺寸，且禁止用户最大化 / 调整尺寸（是入口页、非工作区）。
    const monitor = await monitorLogicalSize()
    const size = monitor ? computeLaunchSize(monitor) : LAUNCH_WINDOW
    await spawnWindow('launch', {
      url: 'index.html', width: size.width, height: size.height,
      resizable: false, maximizable: false,
    })
  },
  currentWindowMode(): WindowMode {
    const label = getCurrentWindow().label
    return label === 'editor' || label === 'launch' ? label : null
  },
  currentWindowProject() {
    return new URLSearchParams(window.location.search).get('project')
  },
  async currentMonitorSize() {
    return monitorLogicalSize()
  },
  async setWindowSize(width, height) {
    // 逻辑尺寸（DPI 无关，与 tauri.conf width/height 同单位）；改尺寸后居中，避免从角部放大而溢出屏幕
    const w = getCurrentWindow()
    await w.setSize(new LogicalSize(width, height))
    await w.center()
  },
  async onWindowResize(handler) {
    // onResized 给物理尺寸；除以缩放因子换算成逻辑尺寸（与 setWindowSize 同单位，往返一致）
    const w = getCurrentWindow()
    const scale = await w.scaleFactor()
    return w.onResized(({ payload }) => handler(Math.round(payload.width / scale), Math.round(payload.height / scale)))
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
