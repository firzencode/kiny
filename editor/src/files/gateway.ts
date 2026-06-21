import type { ResolveAsset } from '@kiny/player'

/** 项目清单（kiny.json）。entry 为入口文件名（如 'main.kin'）。 */
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
  files: ProjectFileEntry[] // 递归扫到的全部文件，按 path 升序
  emptyDirs: string[]       // 不含任何文件的目录相对路径
}

/**
 * 文件 IO 隔离层。真实现走 Tauri 插件（tauriFileGateway），
 * 测试实现走内存表（memoryFileGateway），让前端逻辑全程可单测、不碰 Tauri。
 */
export interface FileGateway {
  pickProjectDir(): Promise<string | null>
  newProject(): Promise<string | null>
  readProject(dir: string): Promise<LoadedProject>
  /** 在项目内新建 .kin（脚手架空文件）。relPath 可含子目录，自动补 .kin。 */
  createFile(dir: string, relPath: string): Promise<ProjectFileEntry>
  /** 写回项目内某文件（relPath 相对项目根）。 */
  writeFile(dir: string, relPath: string, text: string): Promise<void>
  /** 资源解析器：项目根相对路径 → 可渲染 URL。 */
  makeResolveAsset(dir: string): ResolveAsset
  /** 建空文件夹（relDir 相对项目根）。 */
  createFolder(dir: string, relDir: string): Promise<void>
  /** 改名 / 移动：from、to 为相对项目根路径（文件或目录）。目标已存在抛错。 */
  renamePath(dir: string, from: string, to: string): Promise<void>
  /** 删除文件或目录（目录递归）。 */
  deletePath(dir: string, relPath: string): Promise<void>
  /** 写回 kiny.json（入口改名时同步）。 */
  writeManifest(dir: string, manifest: Manifest): Promise<void>
  /** 弹原生保存对话框选 .kip 落点；用户取消返 null。defaultName 为建议文件名。 */
  pickSaveKipPath(defaultName: string): Promise<string | null>
  /** 把项目目录 dir 打包成 .kip 写到 destPath（reader 可导入的 zip）。 */
  exportKip(dir: string, destPath: string): Promise<void>
  /** 危险操作确认：真实现弹原生框，内存桩返回固定值。 */
  confirm(message: string): Promise<boolean>
  /** 强制关闭窗口（destroy，绕过 close-requested 守卫，避免自触发死循环）。 */
  closeWindow(): Promise<void>
  /** 订阅 OS 窗口关闭请求；回调里已 preventDefault。返回退订函数。 */
  onWindowCloseRequest(handler: () => void): Promise<() => void>
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

/** 起始 kiny.json 脚手架（newProject 用，name 由调用方填）。 */
export function starterManifest(name: string): Manifest {
  return { name, version: '1.0.0', engine: __KINY_VERSION__, entry: 'main.kin' }
}

/** 故事名 → 安全的默认 .kip 文件名：去 Windows 文件名非法字符与首尾空白，空结果回退 story。 */
export function defaultKipName(storyName: string): string {
  const base = storyName.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${base || 'story'}.kip`
}
