import { readTextFile, readDir } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import {
  discoverAssets, buildProjectCss, parseCharacters, CHARACTERS_FILE,
  type ResolveAsset, type CharacterTable,
} from '@kiny/player'
import { findManifest, type Story, type ValidatedProgram } from '@kiny/engine'
import { assembleStory } from './assembleStory'

export type LoadOutcome =
  | {
      ok: true
      story: Story
      resolveAsset: ResolveAsset
      title: string
      program: ValidatedProgram
      projectCss: string
      /** 作品角色表（`characters.json`）；未带 / 坏文件 = 空表，不着色。 */
      characters: CharacterTable
    }
  | { ok: false; message: string }

/** 递归扫 dir，收集全部文件的相对路径（'/' 分隔；跳过 `.` 开头项，与打包 / 发现规则一致）。 */
async function collectPaths(dir: string): Promise<string[]> {
  const paths: string[] = []
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const e of await readDir(abs)) {
      if (e.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) await walk(await join(abs, e.name), childRel)
      else if (e.isFile) paths.push(childRel)
    }
  }
  await walk(dir, '')
  return paths
}

export async function loadStory(dir: string, seed?: number): Promise<LoadOutcome> {
  let manifestText: string
  const files = new Map<string, string>()
  let manifestName: string
  let projectCss = ''
  let charactersText: string | null = null
  const resolveAsset: ResolveAsset = (name) => convertFileSrc(`${dir}/${name}`)
  try {
    const rootNames = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name)
    const found = findManifest(rootNames)
    if (!found.ok) return { ok: false, message: found.message }
    manifestName = found.name
    manifestText = await readTextFile(await join(dir, manifestName))
    const paths = await collectPaths(dir)
    // engine 只吃 .kin 文本；css 另取文本编译进作品主题，字体走 asset 协议 URL。
    for (const p of paths.filter((p) => p.endsWith('.kin'))) {
      files.set(p, await readTextFile(await join(dir, p)))
    }
    const assets = discoverAssets(paths.filter((p) => p !== manifestName))
    const cssText = new Map<string, string>()
    for (const p of assets.css) {
      // css 读失败**不算加载失败**：样式缺失只是不好看，故事照样能读（buildProjectCss 记 issue 跳过）。
      try { cssText.set(p, await readTextFile(await join(dir, p))) } catch { /* 跳过这一份 */ }
    }
    projectCss = buildProjectCss(assets, { readCss: (p) => cssText.get(p) ?? null, resolveAsset }).css
    // 角色表：与 css 同性质的约定名文件，读失败**不算加载失败**（不着色而已，故事照样读）。
    if (paths.includes(CHARACTERS_FILE)) {
      try { charactersText = await readTextFile(await join(dir, CHARACTERS_FILE)) } catch { /* 不着色 */ }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '读取故事失败' }
  }
  const res = assembleStory(manifestText, files, seed, manifestName)
  if (!res.ok) return res
  return {
    ok: true,
    story: res.story,
    resolveAsset,
    title: res.title,
    program: res.program,
    projectCss,
    characters: parseCharacters(charactersText),
  }
}
