import type { ResolveAsset } from '../host/commands'

/**
 * 以 css 文件所在目录为基准解析引用路径，返回项目根相对路径（'/' 分隔、已消解 `.` 与 `..`）。
 * 越过项目根的 `..` 被丢弃（宿主 resolveAsset 只认项目内路径）。
 */
export function resolveRelative(cssPath: string, ref: string): string {
  const dir = cssPath.split('/').slice(0, -1)
  const out = [...dir]
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** 无需重写的引用：数据 / 网络 / 协议相对 / 站点绝对路径 / blob / 片段。 */
function external(ref: string): boolean {
  return /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/|#)/.test(ref)
}

/** 把解析后的 URL 放进 `url("…")`：转义反斜杠与双引号，杜绝断出 css 语法。 */
export function cssUrl(url: string): string {
  return `url("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
}

/**
 * 重写作品 css 里的相对 `url()` 引用：基准 = css 文件所在目录 → 项目根相对路径 → 宿主 `resolveAsset`
 * （viewer 相对 URL / reader asset 协议 / shelf objectURL / 导出网页 data-URI）。
 * `data:` `http(s):` `//` `/` `blob:` `#` 开头的引用原样保留；宿主解析不出（空串）时保留原写法，
 * 免得产出 `url("")` 触发对当前页面的自引用请求。
 */
export function rewriteCssUrls(css: string, cssPath: string, resolve: ResolveAsset): string {
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/g, (whole, dq, sq, bare) => {
    const ref = (dq ?? sq ?? bare ?? '') as string
    if (ref === '' || external(ref)) return whole
    const url = resolve(resolveRelative(cssPath, ref))
    return url === '' ? whole : cssUrl(url)
  })
}
