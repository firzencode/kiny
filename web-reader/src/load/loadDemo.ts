import { findManifest } from '@kiny/engine'
import { buildStory, randomSeed, type LoadOutcome, type LoadedStory } from './buildStory'

export type { LoadOutcome, LoadedStory }

/**
 * 浏览器侧收集（packaging-spec §3）：fetch demo 文本 → 共享 buildStory 流水线 → Story。
 * 引擎 PRNG 默认种子固定，`.kin` 自身无熵源；故由宿主注入真随机种子，
 * 让 demo 里 `random(...)` 决定的随机身份每次游玩可能不同。测试可显式传 seed 复现。
 *
 * 浏览器无法枚举目录，故 manifest 文件名（`<名>.kiw`）经 files.json 索引告知：从索引
 * findManifest 挑 manifest（回退旧 kiny.json）、其余条目作 .kin 故事文件。
 */
export async function loadDemo(base = 'demo/', seed = randomSeed()): Promise<LoadOutcome> {
  const text = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`无法加载 ${p}`)
    return r.text()
  }
  let manifestText: string
  let manifestName: string
  let index: string[]
  const files = new Map<string, string>()
  try {
    index = JSON.parse(await text('files.json')) as string[]
    const found = findManifest(index)
    if (!found.ok) return { ok: false, message: found.message }
    manifestName = found.name
    manifestText = await text(manifestName)
    for (const p of index) if (p !== manifestName) files.set(p, await text(p))
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '加载失败' }
  }

  return buildStory(manifestText, files, base, seed, manifestName)
}
