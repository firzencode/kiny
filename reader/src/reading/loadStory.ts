import { readTextFile, readDir } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import type { ResolveAsset } from '@kiny/player'
import { findManifest, type Story, type ValidatedProgram } from '@kiny/engine'
import { assembleStory } from './assembleStory'

export type LoadOutcome =
  | { ok: true; story: Story; resolveAsset: ResolveAsset; title: string; program: ValidatedProgram }
  | { ok: false; message: string }

/** 递归扫 dir，收集全部 `.kin` 的相对路径 → 文本（engine 只吃文本，assets 不读）。 */
async function collectKin(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const e of await readDir(abs)) {
      if (e.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) await walk(await join(abs, e.name), childRel)
      else if (e.isFile && childRel.endsWith('.kin')) files.set(childRel, await readTextFile(await join(abs, e.name)))
    }
  }
  await walk(dir, '')
  return files
}

export async function loadStory(dir: string, seed?: number): Promise<LoadOutcome> {
  let manifestText: string
  let files: Map<string, string>
  let manifestName: string
  try {
    const rootNames = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name)
    const found = findManifest(rootNames)
    if (!found.ok) return { ok: false, message: found.message }
    manifestName = found.name
    manifestText = await readTextFile(await join(dir, manifestName))
    files = await collectKin(dir)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '读取故事失败' }
  }
  const res = assembleStory(manifestText, files, seed, manifestName)
  if (!res.ok) return res
  const resolveAsset: ResolveAsset = (name) => convertFileSrc(`${dir}/${name}`)
  return { ok: true, story: res.story, resolveAsset, title: res.title, program: res.program }
}
