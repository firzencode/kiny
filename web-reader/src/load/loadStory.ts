import { loadDemo } from './loadDemo'
import { buildStory, randomSeed, type LoadOutcome, type LoadedStory } from './buildStory'

export type { LoadOutcome, LoadedStory }

/**
 * 导出独立网页注入的内联项目数据（editor 导出管线写入 `window.__KINY_PROJECT__`）：
 * manifest 为 kiny.json 文本、files 为各 .kin 路径→源码、assetBase 为资源前缀（默认 ''）。
 * 资源名是项目根相对全路径（如 `assets/x.jpg`），导出网页 index.html 在 dest 根、
 * assets 拷到 `dest/assets/`，故前缀为空即直接相对引用。
 */
export interface InlineProject {
  manifest: string
  files: Record<string, string>
  assetBase?: string
}

/** 读取并校验 `window.__KINY_PROJECT__`；非合法内联对象（含未注入的占位字符串）返回 null。 */
function inlineProject(): InlineProject | null {
  const p = (window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__
  if (p && typeof p === 'object' && typeof (p as InlineProject).manifest === 'string') {
    return p as InlineProject
  }
  return null
}

/**
 * 统一加载入口（reader-design §3）：检测到内联 `window.__KINY_PROJECT__` 走内联数据
 * （导出独立网页：file:// 下不能 fetch 本地文本），否则回退 fetch demo（线上 demo / 介绍站）。
 * 同一份 web-reader 既服务线上 demo 又服务导出网页。
 */
export async function loadStory(seed = randomSeed()): Promise<LoadOutcome> {
  const inline = inlineProject()
  if (inline) {
    const files = new Map(Object.entries(inline.files))
    return buildStory(inline.manifest, files, inline.assetBase ?? '', seed)
  }
  return loadDemo('demo/', seed)
}
