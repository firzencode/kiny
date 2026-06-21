import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import type { Story } from '@kiny/engine'

export interface LoadedStory {
  story: Story
  assetBase: string
  title: string
}
export type LoadOutcome = { ok: true; value: LoadedStory } | { ok: false; message: string }

/**
 * 浏览器侧收集（packaging-spec §3）：fetch demo 文本 → engine 纯流水线 → Story。
 * 引擎 PRNG 默认种子固定，`.kin` 自身无熵源；故由宿主注入真随机种子，
 * 让 demo 里 `random(...)` 决定的随机身份每次游玩可能不同。测试可显式传 seed 复现。
 */
export async function loadDemo(
  base = 'demo/',
  seed = Math.floor(Math.random() * 0x1_0000_0000),
): Promise<LoadOutcome> {
  const text = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`无法加载 ${p}`)
    return r.text()
  }
  let manifestText: string
  let index: string[]
  const files = new Map<string, string>()
  try {
    manifestText = await text('kiny.json')
    index = JSON.parse(await text('files.json')) as string[]
    for (const p of index) files.set(p, await text(p))
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '加载失败' }
  }

  const res = loadProjectFromFiles(manifestText, files)
  if (!res.ok) return { ok: false, message: res.errors.map((e) => e.message).join('; ') }

  const { program, diagnostics } = analyze(res.files)
  if (!program) {
    return { ok: false, message: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ') }
  }
  const start = resolveStart(program, res.entry)
  if (start === null) return { ok: false, message: '无可运行入口' }

  const story = createStory(program, { start, seed })
  return { ok: true, value: { story, assetBase: base, title: res.meta.name } }
}
