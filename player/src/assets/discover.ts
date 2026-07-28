import { sortByPath } from '@kiny/engine'

/** 自动注册 `@font-face` 的字体文件扩展名。 */
const FONT_EXTS = ['.woff2', '.woff', '.ttf', '.otf']

/** 项目内被自动加载的前端资源（路径为项目根相对、'/' 分隔），各自按路径字典序。 */
export interface DiscoveredAssets {
  /** 全部 `.css`，按路径字典序注入（`10-` / `20-` 文件名前缀可控序）。 */
  css: string[]
  /** 全部字体文件，自动注册 `@font-face`。 */
  fonts: string[]
}

/** 路径末段的小写扩展名（含点）；无扩展名返回空串。 */
function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot).toLowerCase()
}

/** 发现排除规则（与 editor 项目扫描一致）：任意路径段以 `.` 开头，或段为 `node_modules`。 */
function excluded(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules')
}

/**
 * 零目录约定的资源发现：项目内**任何位置**的 `.css` / 字体文件都被识别，作者自由编排子目录。
 * 不想让某文件生效 → 改扩展名（如 `skin.css.bak`）。图片 / 音频等不参与自动加载
 * （被 css `url()` 或脚本命令引用即可）。
 */
export function discoverAssets(paths: Iterable<string>): DiscoveredAssets {
  const css: string[] = []
  const fonts: string[] = []
  for (const p of paths) {
    if (excluded(p)) continue
    const ext = extOf(p)
    if (ext === '.css') css.push(p)
    else if (FONT_EXTS.includes(ext)) fonts.push(p)
  }
  const byPath = (xs: string[]) => sortByPath(xs.map((path) => ({ path }))).map((x) => x.path)
  return { css: byPath(css), fonts: byPath(fonts) }
}

/** 字体文件路径 → 族名：文件名去目录、去最后一段扩展名（`fonts/楷体.woff2` → `楷体`）。 */
export function familyOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}
