import { findManifest } from '@kiny/engine'
import { discoverAssets, buildProjectCss } from '@kiny/player'
import { buildStory, randomSeed, type LoadOutcome, type LoadedStory } from './buildStory'

export type { LoadOutcome, LoadedStory }

/**
 * 浏览器侧收集（packaging-spec §3）：fetch demo 文本 → 共享 buildStory 流水线 → Story。
 * 引擎 PRNG 默认种子固定，`.kin` 自身无熵源；故由宿主注入真随机种子，
 * 让 demo 里 `random(...)` 决定的随机身份每次游玩可能不同。测试可显式传 seed 复现。
 *
 * 浏览器无法枚举目录，故项目文件清单经 files.json 索引告知（stage-sample 递归生成）：
 * findManifest 挑 manifest、`.kin` 作故事文件、`.css` 与字体按前端资源规则加载
 * （css 取文本注入，字体经相对 URL），其余（图片 / 音频）只在被引用时按需加载。
 */
export async function loadDemo(base = 'demo/', seed = randomSeed()): Promise<LoadOutcome> {
  const text = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`无法加载 ${p}`)
    return r.text()
  }
  let manifestText: string
  let manifestName: string
  let projectCss = ''
  const files = new Map<string, string>()
  try {
    const index = JSON.parse(await text('files.json')) as string[]
    const found = findManifest(index)
    if (!found.ok) return { ok: false, message: found.message }
    manifestName = found.name
    const entryPaths = index.filter((p) => p.endsWith('.kin'))
    const assets = discoverAssets(index.filter((p) => p !== manifestName))
    // 并行 fetch manifest + 全部 .kin + 全部 .css（此前逐个 await 串行，N 个文件 N 趟往返）；
    // 结果按 entryPaths（即 files.json 顺序）插入 files，保持文件表插入序不变（Q5）。
    // css 取不到**不算加载失败**（各自 catch 成 null）——样式缺失只是不好看，故事照样能读。
    const [mText, ...rest] = await Promise.all([
      text(manifestName),
      ...entryPaths.map((p) => text(p)),
      ...assets.css.map((p) => text(p).catch(() => null)),
    ])
    manifestText = mText as string
    entryPaths.forEach((p, i) => files.set(p, rest[i] as string))
    const cssText = new Map(assets.css.map((p, i) => [p, rest[entryPaths.length + i] as string | null]))
    projectCss = buildProjectCss(assets, {
      readCss: (p) => cssText.get(p) ?? null,
      resolveAsset: (name) => base + name,
    }).css
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '加载失败' }
  }

  return buildStory(manifestText, files, base, seed, manifestName, projectCss)
}
