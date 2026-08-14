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
  /**
   * 作品前端资源编译出的 css（导出管线已把 `.css` 内联、项目内字体 `url()` 重写为 data-URI）。
   * `file://` 下无法 fetch 旁挂文本、且 Chrome 拒载外链字体，故必须内联随页面走。
   */
  css?: string
  /**
   * 角色表 `characters.json` 的**原始文本**（导出管线内联）。`file://` 下无法 fetch 旁挂文本，
   * 故与 css 同样内联随页面走。
   */
  characters?: string
}

/** 内联数据探测结果：无注入（占位/缺 manifest）| 合法 | 有 manifest 但形状损坏。 */
type InlineProbe = { kind: 'none' } | { kind: 'ok'; project: InlineProject } | { kind: 'corrupt' }

/** 读取并校验 `window.__KINY_PROJECT__`；非对象 / 缺 manifest（含未注入的占位字符串）视为无注入；
 * 有 manifest 但 `files` 缺失或非 string→string 表则判「损坏」——不得静默回退 fetch 掩盖问题，
 * 更不能带着 undefined 进 `Object.entries` 抛 TypeError（导出网页白屏无诊断）。 */
function inlineProject(): InlineProbe {
  const p = (window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__
  if (!p || typeof p !== 'object' || typeof (p as InlineProject).manifest !== 'string') {
    return { kind: 'none' }
  }
  const files = (p as InlineProject).files
  if (!files || typeof files !== 'object' || Object.values(files).some((v) => typeof v !== 'string')) {
    return { kind: 'corrupt' }
  }
  return { kind: 'ok', project: p as InlineProject }
}

/**
 * 统一加载入口（reader-design §3）：检测到内联 `window.__KINY_PROJECT__` 走内联数据
 * （导出独立网页：file:// 下不能 fetch 本地文本），否则回退 fetch demo（线上 demo / 介绍站）。
 * 同一份 viewer 既服务线上 demo 又服务导出网页。
 */
export async function loadStory(seed = randomSeed()): Promise<LoadOutcome> {
  const probe = inlineProject()
  if (probe.kind === 'corrupt') {
    return { ok: false, message: '导出数据损坏：__KINY_PROJECT__ 的 files 缺失或格式非法，请用编辑器重新导出独立网页。' }
  }
  if (probe.kind === 'ok') {
    const inline = probe.project
    const files = new Map(Object.entries(inline.files))
    const css = typeof inline.css === 'string' ? inline.css : ''
    const characters = typeof inline.characters === 'string' ? inline.characters : null
    return buildStory(inline.manifest, files, inline.assetBase ?? '', seed, 'kiny.json', css, characters)
  }
  return loadDemo('demo/', seed)
}
