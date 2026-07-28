import { validFont } from '@kiny/engine'
import type { ResolveAsset } from '../host/commands'
import { familyOf, type DiscoveredAssets } from './discover'
import { rewriteCssUrls, cssUrl } from './rewrite'

/** 一处资源加载问题（editor 据此提示作者；播放端静默跳过，绝不因资源问题黑屏）。 */
export type AssetIssue =
  | { kind: 'bad-font-name'; path: string; family: string }
  | { kind: 'font-conflict'; path: string; family: string }
  | { kind: 'font-unresolved'; path: string; family: string }
  | { kind: 'css-unreadable'; path: string }

/** 宿主侧的资源读取能力：css 取文本（读不到返 null）、任意项目内路径取可用 URL（取不到返空串）。 */
export interface AssetSources {
  readCss: (path: string) => string | null
  resolveAsset: ResolveAsset
}

const FORMATS: Record<string, string> = {
  '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype',
}

function formatOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? undefined : FORMATS[path.slice(dot).toLowerCase()]
}

/**
 * 把项目内发现的前端资源编译成**一段** css 文本：先全部 `@font-face`（族名 = 文件名去扩展名），
 * 再按给定顺序拼接各 `.css`（每段的相对 `url()` 已按其所在目录重写为宿主可用 URL）。
 * 纯函数——宿主只需把这段文本注入一个 `<style>`（见 `ProjectStyles`），故天然幂等：
 * restore / replay / 编辑重算产出同样文本、同一个 style 元素。
 * 资源问题（非法族名 / 同名冲突 / 读不到）不抛错，收进 issues 交 editor 提示。
 */
export function buildProjectCss(assets: DiscoveredAssets, sources: AssetSources): { css: string; issues: AssetIssue[] } {
  const issues: AssetIssue[] = []
  const parts: string[] = []

  // 同名族按路径序**后者覆盖**：先按族名建表（记冲突），再一次性产出，避免同族多条 @font-face 叠加。
  const byFamily = new Map<string, { path: string; url: string }>()
  for (const path of assets.fonts) {
    const family = familyOf(path)
    if (!validFont(family)) {
      issues.push({ kind: 'bad-font-name', path, family })
      continue
    }
    const url = sources.resolveAsset(path)
    if (url === '') {
      issues.push({ kind: 'font-unresolved', path, family })
      continue
    }
    if (byFamily.has(family)) issues.push({ kind: 'font-conflict', path, family })
    byFamily.set(family, { path, url })
  }
  for (const [family, { path, url }] of byFamily) {
    const fmt = formatOf(path)
    // 与 css 内 url() 重写共用同一转义（宿主给的 URL 可能含引号 / 反斜杠——文件名在 Linux/macOS 上合法）。
    const src = `${cssUrl(url)}${fmt ? ` format("${fmt}")` : ''}`
    parts.push(`@font-face { font-family: "${family}"; src: ${src}; font-display: swap; }`)
  }

  for (const path of assets.css) {
    const text = sources.readCss(path)
    if (text === null) {
      issues.push({ kind: 'css-unreadable', path })
      continue
    }
    if (text.trim() === '') continue
    parts.push(`/* ${path} */\n${rewriteCssUrls(text, path, sources.resolveAsset)}`)
  }

  return { css: parts.join('\n'), issues }
}
