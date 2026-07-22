import { assembleFromFiles, type Story, type ValidatedProgram } from '@kiny/engine'
import type { ResolveAsset } from '@kiny/player'
import type { UnzippedKip } from '../kip/unzipKip'

export interface Loaded {
  story: Story
  program: ValidatedProgram
  resolveAsset: ResolveAsset
  title: string
  version: string
  /** 本次会话建的全部资源 objectURL；调用方离开阅读 / 切书 / 卸载时逐一 revokeObjectURL 回收。 */
  assetUrls: string[]
}

/**
 * 把一份解压后的 `.kip` 装配成可播放态：
 * 先 assembleFromFiles 校验装配（失败即抛，此时尚未建任何 objectURL，无泄漏），
 * 再为每个资源 Blob 建 objectURL，resolveAsset 按资源名查表（未知名回退空串，与 viewer 一致）。
 */
export function loadFromLibrary(pkg: UnzippedKip): Loaded {
  const res = assembleFromFiles(pkg.manifestText, pkg.kinFiles, { manifestName: pkg.manifestName })
  if (!res.ok) throw new Error(res.message)

  const urlByName = new Map<string, string>()
  const assetUrls: string[] = []
  for (const [name, blob] of pkg.assets) {
    const url = URL.createObjectURL(blob)
    urlByName.set(name, url)
    assetUrls.push(url)
  }
  const resolveAsset: ResolveAsset = (name) => urlByName.get(name) ?? ''
  return {
    story: res.story,
    program: res.program,
    resolveAsset,
    title: res.meta.name,
    version: res.meta.version,
    assetUrls,
  }
}
