import type { ResolveAsset } from '@kiny/player'
import type { DraftStore } from '../state/drafts'
import type { ChatStore } from '../state/chatStore'

/** 项目清单（`<项目名>.kiw` 或旧 kiny.json）。entry 为入口文件名（如 'main.kin'）。 */
export interface Manifest {
  name: string
  version: string
  engine: string
  entry: string
}

/** 一个项目文件。path 为相对项目根、'/' 分隔的归一路径。 */
export interface ProjectFileEntry {
  path: string
  isKin: boolean
  source?: string // 仅 .kin 载入文本
}

/** 一次读盘的项目快照（携带全部文件 + 空目录）。 */
export interface LoadedProject {
  dir: string
  manifest: Manifest
  manifestFile: string      // 所定位的 manifest 文件名（`<名>.kiw` 或旧 kiny.json），供写回 / 导出
  files: ProjectFileEntry[] // 递归扫到的全部文件，按 path 升序
  emptyDirs: string[]       // 不含任何文件的目录相对路径
}

/**
 * 文件 IO 隔离层。真实现走 Tauri 插件（tauriFileGateway），
 * 测试实现走内存表（memoryFileGateway），让前端逻辑全程可单测、不碰 Tauri。
 */
export interface FileGateway {
  /** 弹文件选择器选项目文件（`.kiw`，兼容旧 `kiny.json`——选中后经父目录 findManifest 定位并自动迁移）；返回其**父目录**，取消返 null。 */
  pickProjectFile(): Promise<string | null>
  newProject(): Promise<string | null>
  readProject(dir: string): Promise<LoadedProject>
  /** 在项目内新建 .kin（脚手架空文件）。relPath 可含子目录，自动补 .kin。 */
  createFile(dir: string, relPath: string): Promise<ProjectFileEntry>
  /** 写回项目内某文件（relPath 相对项目根）。 */
  writeFile(dir: string, relPath: string, text: string): Promise<void>
  /** 弹系统文件选择器选媒体资源（图片 + 音频，可多选）；返回绝对路径数组，取消返 null。 */
  pickImportFiles(): Promise<string[] | null>
  /** 把外部文件 sourceAbsPath 拷入项目为 destRel（相对项目根）；父目录不存在时自动建。 */
  importAsset(dir: string, destRel: string, sourceAbsPath: string): Promise<void>
  /** 资源解析器：项目根相对路径 → 可渲染 URL。 */
  makeResolveAsset(dir: string): ResolveAsset
  /** 建空文件夹（relDir 相对项目根）。 */
  createFolder(dir: string, relDir: string): Promise<void>
  /** 改名 / 移动：from、to 为相对项目根路径（文件或目录）。目标已存在抛错。 */
  renamePath(dir: string, from: string, to: string): Promise<void>
  /** 删除文件或目录（目录递归）。 */
  deletePath(dir: string, relPath: string): Promise<void>
  /** 写回 manifest（入口改名时同步）；manifestFile 为所定位的 manifest 文件名（`<名>.kiw` 或旧 kiny.json）。 */
  writeManifest(dir: string, manifest: Manifest, manifestFile: string): Promise<void>
  /** 弹原生保存对话框选 .kip 落点；用户取消返 null。defaultName 为建议文件名。 */
  pickSaveKipPath(defaultName: string): Promise<string | null>
  /** 把项目目录 dir 打包成 .kip 写到 destPath（reader 可导入的 zip）。 */
  exportKip(dir: string, destPath: string): Promise<void>
  /** 弹原生目录对话框选导出网页的父目录；用户取消返 null。 */
  pickExportWebpageDir(): Promise<string | null>
  /**
   * 把项目导出成自包含独立网页：在 parentDir 下建 folderName 文件夹，写注入了 projectData 的
   * index.html + 拷 assets。返回最终目标文件夹路径（用于成功提示）。
   */
  exportWebpage(projectDir: string, parentDir: string, folderName: string, projectData: string): Promise<string>
  /** 危险操作确认：真实现弹原生框，内存桩返回固定值。 */
  confirm(message: string): Promise<boolean>
  /** 强制关闭窗口（destroy，绕过 close-requested 守卫，避免自触发死循环）。 */
  closeWindow(): Promise<void>
  /** 订阅 OS 窗口关闭请求；回调里已 preventDefault。返回退订函数。 */
  onWindowCloseRequest(handler: () => void): Promise<() => void>
  /** 订阅「用 OS 双击 / 关联打开某 `.kiw` 文件」事件（single-instance 转发，热启动用）；回调收到项目文件绝对路径。返回退订函数。 */
  onOpenProjectFile(handler: (path: string) => void): Promise<() => void>
  /** 取走冷启动待打开的 `.kiw` 路径（OS 双击首次拉起时 Rust 暂存）；无则 null。前端 mount 后调用一次。 */
  takeLaunchProject(): Promise<string | null>
  /** 读全部自动保存草稿（落 app-data，与项目目录隔离）；无 / 损坏 → 空 store。 */
  readDraftStore(): Promise<DraftStore>
  /** 写全部自动保存草稿；失败静默（背景安全网，同 settings/session 持久化惯例）。 */
  writeDraftStore(store: DraftStore): Promise<void>
  /** 读某项目的 AI 对话存储（<AppData>/ai-chats/<key>.json）；无 / 损坏 → null。 */
  readChatStore(key: string): Promise<ChatStore | null>
  /** 写某项目的 AI 对话存储；失败静默（背景安全网，同草稿惯例）。 */
  writeChatStore(key: string, store: ChatStore): Promise<void>
  /** 删某项目的 AI 对话存储文件（会话清空时清理，免孤儿空文件）；失败静默。 */
  deleteChatStore(key: string): Promise<void>
  /** 列出 ai-chats/ 下全部项目文件的 key（启动期按日期清理用）；无目录 / 失败 → []。 */
  listChatStoreKeys(): Promise<string[]>
}

/** 起始 main.kin 脚手架内容（newProject 用）。 */
export const STARTER_MAIN_KIN = `=== 开场 ===
你站在码头边，雾气漫过脚踝。
* [向左走] -> 左
* [向右走] -> 右
=== 左 ===
左边是一排吊脚楼。
-> END
=== 右 ===
右边泊着一条旧船。
-> END
`

/** 新建文件脚手架内容（createFile 用）。 */
export const STARTER_NEW_FILE = `=== 新节点 ===
`

/** 校验相对路径安全：禁止空串、`.`、绝对路径与 `..` 穿越，否则抛错。 */
export function assertSafeRelPath(rel: string): void {
  if (rel === '' || rel === '.' || rel.startsWith('/') || rel.split('/').some((seg) => seg === '..')) {
    throw new Error(`非法路径: ${rel}`)
  }
}

/** 把文件名归一为合法 .kin 名：去空白、补 .kin 后缀。空名抛错。 */
export function normalizeKinName(raw: string): string {
  const t = raw.trim()
  if (t === '') throw new Error('文件名不能为空')
  const name = t.endsWith('.kin') ? t : `${t}.kin`
  assertSafeRelPath(name)
  return name
}

/** 起始 manifest 脚手架（newProject 用，name 由调用方填）。 */
export function starterManifest(name: string): Manifest {
  return { name, version: '1.0.0', engine: __KINY_VERSION__, entry: 'main.kin' }
}

/** 项目名 → 项目文件名 `<sanitize>.kiw`（去 Windows 文件名非法字符与首尾空白，空结果回退 project）。 */
export function projectFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${base || 'project'}.kiw`
}

/** 故事名 → 安全的默认 .kip 文件名：去 Windows 文件名非法字符与首尾空白，空结果回退 story。 */
export function defaultKipName(storyName: string): string {
  const base = storyName.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${base || 'story'}.kip`
}

/** 故事名 → 默认导出网页文件夹名 `<名>-web`（去非法字符，空结果回退 story-web）。 */
export function defaultWebpageDirName(storyName: string): string {
  const base = storyName.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${base || 'story'}-web`
}

/**
 * 组装导出独立网页的内联数据（写入 `window.__KINY_PROJECT__`，对应 web-reader 的 InlineProject）：
 * manifest 文本 + 各 .kin 路径→源码。资源走 `assets/` 相对引用（资源名自带 assets/ 前缀），故 assetBase 空。
 *
 * 数据被原样拼进导出 index.html 的内联 `<script>`，故须转义 `< > &`——否则 .kin 文本里的
 * `</script>` 会提前闭合脚本、损坏页面。`\uXXXX` 是合法 JSON 转义，浏览器解析回原字符，往返无损。
 */
export function buildProjectData(manifest: Manifest, files: { path: string; source: string }[]): string {
  const fileMap: Record<string, string> = {}
  for (const f of files) fileMap[f.path] = f.source
  const json = JSON.stringify({ manifest: JSON.stringify(manifest), files: fileMap, assetBase: '' })
  return json.replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
