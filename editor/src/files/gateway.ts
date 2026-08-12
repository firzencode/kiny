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
  source?: string // 文本文件（.kin 与作品前端资源，见 isTextFile）载入文本；二进制无
}

/**
 * editor 可直接编辑的文本文件（与 `.kin` 同等待遇：点开即编辑保存、带对应语言高亮）。
 * 二进制（图片 / 音频 / 字体）不在此列，Explorer 只列名。
 */
const TEXT_EXTS = ['.kin', '.css', '.js', '.json', '.txt', '.md', '.html']

/** 路径末段命中的已知文本扩展名（小写，含点）；未命中返回 undefined。 */
function textExtOf(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  return TEXT_EXTS.find((e) => base.endsWith(e))
}

export function isTextFile(path: string): boolean {
  return textExtOf(path) !== undefined
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
 * 当前 OS 窗口的角色（Tauri 多窗模型 A · 互斥交接）：
 * - 'launch' → 启动窗（只渲染 LaunchScreen，永不进 workbench）
 * - 'editor' → 编辑窗（只渲染 workbench，从 URL ?project 载入项目；结构上坐实「始终已打开项目」）
 * - null → 非 Tauri（web / 测试）无 OS 窗口概念，走单页 SPA 切换（projectDir 有无翻转）
 */
export type WindowMode = 'launch' | 'editor' | null

/**
 * 文件 IO 隔离层。真实现走 Tauri 插件（tauriFileGateway），
 * 测试实现走内存表（memoryFileGateway），让前端逻辑全程可单测、不碰 Tauri。
 */
export interface FileGateway {
  /** 弹文件选择器选项目文件（`.kiw`，兼容旧 `kiny.json`——选中后经父目录 findManifest 定位并自动迁移）；返回其**父目录**，取消返 null。 */
  pickProjectFile(): Promise<string | null>
  /** 弹原生目录选择器选一个文件夹（新建项目的父目录）；取消返 null。 */
  pickDirectory(): Promise<string | null>
  /**
   * 在 parentDir 下建 `<projectFolderName(name)>` 子文件夹，铺 `<name>.kiw` + `main.kin`
   * + `theme.css`（`manifest.name` = 原始输入名）。返回新建项目根目录；目标子文件夹已存在
   * 则抛错，绝不覆盖。
   */
  newProject(parentDir: string, name: string): Promise<string>
  readProject(dir: string): Promise<LoadedProject>
  /**
   * 在项目内新建文件。relPath 可含子目录；文件名经 `normalizeNewFileName` 归一
   * （已知文本扩展名尊重之，否则补 `.kin`），起始内容经 `starterContentFor` 按类型分派。
   */
  createFile(dir: string, relPath: string): Promise<ProjectFileEntry>
  /** 写回项目内某文件（relPath 相对项目根）。 */
  writeFile(dir: string, relPath: string, text: string): Promise<void>
  /** 读项目内某文本文件（relPath 相对项目根）；读不到 / 非文本抛错。 */
  readTextFile(dir: string, relPath: string): Promise<string>
  /** 弹系统文件选择器选媒体资源（图片 + 音频，可多选）；返回绝对路径数组，取消返 null。 */
  pickImportFiles(): Promise<string[] | null>
  /** 把外部文件 sourceAbsPath 拷入项目为 destRel（相对项目根）；父目录不存在时自动建。 */
  importAsset(dir: string, destRel: string, sourceAbsPath: string): Promise<void>
  /** 资源解析器：项目根相对路径 → 可渲染 URL。 */
  makeResolveAsset(dir: string): ResolveAsset
  /**
   * 读项目内二进制资源为 `data:` URI（导出独立网页内联字体用——`file://` 下 Chrome 按 opaque
   * origin 拒载外链字体，只能内联）。读不到时抛错，由调用方降级。
   */
  readAssetDataUri(dir: string, relPath: string): Promise<string>
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
  /**
   * 导出自定义主题：弹原生保存对话框选落点并写入 JSON 文本（defaultName 为建议文件名）。
   * 用户取消返 false，写入成功返 true。（不走浏览器 `<a download>`——Tauri WebView 里那是静默 no-op。）
   */
  exportThemeFile(defaultName: string, contents: string): Promise<boolean>
  /**
   * 导出线性文稿：弹原生保存对话框选落点并写入 Markdown / 纯文本（defaultName 为建议文件名，ext 为 'md' | 'txt'）。
   * 用户取消返 false，写入成功返 true。
   */
  exportManuscript(defaultName: string, contents: string, ext: 'md' | 'txt'): Promise<boolean>
  /** 危险操作确认：真实现弹原生框，内存桩返回固定值。 */
  confirm(message: string): Promise<boolean>
  /** 强制关闭窗口（destroy，绕过 close-requested 守卫，避免自触发死循环）。 */
  closeWindow(): Promise<void>
  /** spawn 编辑窗（label 'editor'，URL 带 ?project=<dir>，尺寸用记忆的 workbench 尺寸）；失败抛错（调用方弹 notice，不静默）。非 Tauri 桩为 no-op。 */
  openEditorWindow(projectDir: string): Promise<void>
  /** spawn 启动窗（label 'launch'，紧凑固定尺寸）；失败抛错（调用方弹 notice，不静默）。非 Tauri 桩为 no-op。 */
  openLaunchWindow(): Promise<void>
  /** 本窗角色：读 Tauri 窗口 label → 'launch' / 'editor'；非 Tauri 返 null（走 SPA 切换）。同步读取。 */
  currentWindowMode(): WindowMode
  /** 本窗 URL 的 ?project 参数（编辑窗启动时用来载入项目）；无则 null。同步读取。 */
  currentWindowProject(): string | null
  /** 当前显示器逻辑分辨率（宽 × 高，逻辑像素）；非 Tauri / 取不到 → null。启动窗按屏分辨率定尺寸用。 */
  currentMonitorSize(): Promise<{ width: number; height: number } | null>
  /** 设置窗口逻辑尺寸并居中（启动页 ↔ workbench 切换时调整观感）；非 Tauri 环境 no-op。 */
  setWindowSize(width: number, height: number): Promise<void>
  /** 订阅窗口尺寸变化（记忆用户手动调整的 workbench 尺寸）；回调收到逻辑尺寸。返回退订函数。 */
  onWindowResize(handler: (width: number, height: number) => void): Promise<() => void>
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

/** 新建 `.kin` 的脚手架内容（createFile 用）。 */
export const STARTER_NEW_FILE = `=== 新节点 ===
`

/**
 * 起始 `theme.css` 脚手架内容（newProject 内置 + createFile 新建同名文件用）。
 * 以 `.player` 为根而非 `:root`：声明直接落在阅读区元素本身，优先于从根元素继承下来的
 * 宿主取值；且不会漏到 editor 界面上。
 * 列出的 token 名与默认值须与 `player/src/styles.css` 的 `:root` 保持一致（有单测守着）。
 */
export const STARTER_THEME_CSS = `/* 作品主题 —— 改这里就能换掉阅读页的外观。
   项目里任意位置的 .css 都会自动生效；多个文件按路径字典序依次应用
   （想控制先后就用 10- / 20- 这样的文件名前缀）。
   不想让某个文件生效，把扩展名改掉即可（如 theme.css.bak）。 */

.player {
  /* ── 配色 ── */
  --kiny-page-bg: #0d1117;                                   /* 页面底色 */
  --kiny-text: #e8e8e8;                                      /* 正文文字色 */

  /* ── 排印 ── */
  --kiny-prose-font: system-ui, "Noto Sans SC", sans-serif;  /* 正文字体 */
  --kiny-prose-size: 1.05rem;                                /* 正文字号 */
  --kiny-prose-line-height: 1.9;                             /* 行高 */
  --kiny-content-max-width: 680px;                           /* 阅读栏宽度 */

  /* 想用自带字体？把字体文件（.woff2 / .ttf / .otf / .woff）放进项目任意位置，
     族名就是文件名去掉扩展名。例如放 fonts/楷体.woff2，这里写：
     --kiny-prose-font: "楷体", serif; */
}

/* 深度定制：以 .player 为根写选择器（阅读器 / 网页书库里，播放器之外还有它们自己的
   界面元素，带 .player 前缀才不会误伤）。例如给底部固定区域加个底色：
.player .panel-bottom { background: rgba(0, 0, 0, .3); }
*/
`

/**
 * 起始内容：`theme.css` 以外的 `.css`（createFile 用）。**纯注释、零 token 赋值**——
 * 见 `starterContentFor` 的说明：带默认值的第二份 token 会按字典序盖掉作者调好的主题。
 */
export const STARTER_STYLE_CSS = `/* 作品样式 —— 项目里任意位置的 .css 都会自动生效，
   多个文件按路径字典序依次应用（想控制先后就用 10- / 20- 这样的文件名前缀）。

   配色 / 字体 / 字号这类整体外观请改 theme.css 里的 --kiny-* 变量；
   在本文件里重复赋值会按字典序覆盖 theme.css，把主题改回默认。

   本文件适合写选择器（务必带 .player 前缀——阅读器 / 网页书库里播放器之外
   还有它们自己的界面元素，带前缀才不会误伤）：

.player .panel-bottom { background: rgba(0, 0, 0, .3); }
.player .kin-illustration { border-radius: 8px; }
*/
`

/** 校验相对路径安全：禁止空串、`.`、绝对路径与 `..` 穿越，否则抛错。 */
export function assertSafeRelPath(rel: string): void {
  if (rel === '' || rel === '.' || rel.startsWith('/') || rel.split('/').some((seg) => seg === '..')) {
    throw new Error(`非法路径: ${rel}`)
  }
}

/**
 * renamePath 的共享前置守卫：源 / 目标均须安全相对路径，且目标不得是源自身或源的子树
 * （否则会把目录移入自己）。两 gateway 实现共用此单点，杜绝守卫口径漂移（audit b1）。
 * 「目标已存在」检测因后端不同（FS exists / 内存 Map 查表）由各实现自行做。
 */
export function assertRenameSafe(from: string, to: string): void {
  assertSafeRelPath(from)
  assertSafeRelPath(to)
  if (to === from || to.startsWith(`${from}/`)) throw new Error(`不能移入自身: ${to}`)
}

/**
 * 新建文件名归一：已带**已知文本扩展名**（同 `isTextFile` 的 `TEXT_EXTS`）则尊重之、并把该
 * 扩展名归一为小写，否则补 `.kin`。判定与「可编辑」共用同一份扩展名表，使「建得出」与
 * 「打得开」天然一致。空名抛错。
 *
 * 扩展名必须归小写：下游对 `.kin` 的识别区分大小写（引擎与各宿主同口径），作者手打
 * `第二章.KIN` 若原样保留，会得到一个资源管理器里能编辑、引擎却永不加载的哑文件。
 */
export function normalizeNewFileName(raw: string): string {
  const t = raw.trim()
  if (t === '') throw new Error('文件名不能为空')
  const ext = textExtOf(t)
  const name = ext === undefined ? `${t}.kin` : `${t.slice(0, t.length - ext.length)}${ext}`
  assertSafeRelPath(name)
  return name
}

/**
 * 是否 `.kin` 故事文件。**区分大小写**——与 readProject 的 isKin 判定、引擎的文件发现同口径，
 * 免得 editor 认作故事文件而引擎不收。（`.css` 的判定则不区分大小写，同 `discoverAssets`。）
 */
export function isKinFile(path: string): boolean {
  return path.endsWith('.kin')
}

/**
 * 是否**作品主题文件**（约定名 `theme.css`，文件名不分大小写、同 `discoverAssets` 的扩展名口径；
 * 子目录里的同名文件也算）。
 *
 * 这是「哪个文件是主题」的单点判定，两处消费：主题模板只发给它（见 `starterContentFor`），
 * 「外观」GUI 也只对它出现。理由同一条：零目录约定下项目内全部 `.css` 都会被加载并按路径
 * 字典序拼接，第二个样式文件里既不该拿到整份 token 默认值、也不该开 GUI——GUI 会把播放层
 * 默认值当成「这个作品现在的样子」显示（真正生效的是主题文件里的值），随手一拖就把 token
 * 写进那个文件、按字典序盖死主题，而扫描器是单文件的、结构上看不见这件事。
 */
export function isThemeFile(path: string): boolean {
  return path.slice(path.lastIndexOf('/') + 1).toLowerCase() === 'theme.css'
}

/**
 * 新建文件的起始内容：`.kin` 落故事脚手架、`theme.css` 落主题模板、其它 `.css` 落样式空壳、
 * 其它已知文本类型留空。
 */
export function starterContentFor(relPath: string): string {
  if (isKinFile(relPath)) return STARTER_NEW_FILE
  if (isThemeFile(relPath)) return STARTER_THEME_CSS
  if (relPath.toLowerCase().endsWith('.css')) return STARTER_STYLE_CSS
  return ''
}

/** 起始 manifest 脚手架（newProject 用，name 由调用方填）。 */
export function starterManifest(name: string): Manifest {
  return { name, version: '1.0.0', engine: __KINY_VERSION__, entry: 'main.kin' }
}

/** 项目名 → sanitize 基名：去 Windows 文件名非法字符与首尾空白，可返回空串。 */
export function sanitizeProjectBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

/** 项目名 → 项目子文件夹名：sanitize 后为空则回退 project。 */
export function projectFolderName(name: string): string {
  return sanitizeProjectBase(name) || 'project'
}

/** 项目名 → 项目文件名 `<sanitize>.kiw`（与子文件夹名同源，保证一致）。 */
export function projectFileName(name: string): string {
  return `${projectFolderName(name)}.kiw`
}

/** 故事名 → 安全的默认 .kip 文件名：去 Windows 文件名非法字符与首尾空白，空结果回退 story。 */
export function defaultKipName(storyName: string): string {
  const base = sanitizeProjectBase(storyName)
  return `${base || 'story'}.kip`
}

/** 故事名 → 默认导出网页文件夹名 `<名>-web`（去非法字符，空结果回退 story-web）。 */
export function defaultWebpageDirName(storyName: string): string {
  const base = sanitizeProjectBase(storyName)
  return `${base || 'story'}-web`
}

/**
 * 组装导出独立网页的内联数据（写入 `window.__KINY_PROJECT__`，对应 viewer 的 InlineProject）：
 * manifest 文本 + 各 .kin 路径→源码 + 作品主题 css。资源走相对引用（项目文件原样拷到导出目录），
 * 故 assetBase 空。**只收 `.kin`**——css 等前端资源经 projectCss 内联，不进故事文件表。
 *
 * 数据被原样拼进导出 index.html 的内联 `<script>`，故须转义 `< > &`——否则 .kin 文本里的
 * `</script>` 会提前闭合脚本、损坏页面。`\uXXXX` 是合法 JSON 转义，浏览器解析回原字符，往返无损。
 */
export function buildProjectData(
  manifest: Manifest,
  files: { path: string; source: string }[],
  projectCss = '',
): string {
  const fileMap: Record<string, string> = {}
  for (const f of files) if (isKinFile(f.path)) fileMap[f.path] = f.source
  const json = JSON.stringify({ manifest: JSON.stringify(manifest), files: fileMap, assetBase: '', css: projectCss })
  return json.replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
