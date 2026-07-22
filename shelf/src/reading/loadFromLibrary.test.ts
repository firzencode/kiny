import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { unzipKip } from '../kip/unzipKip'
import { loadFromLibrary } from './loadFromLibrary'

const MANIFEST = JSON.stringify({ name: '测试故事', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
const MAIN = '开场。\n-> END\n'

describe('loadFromLibrary', () => {
  it('装配出可播放 Story，资源解析为 blob URL', () => {
    const bytes = zipSync({
      'kiny.json': strToU8(MANIFEST),
      'main.kin': strToU8(MAIN),
      'assets/x.png': new Uint8Array([1, 2, 3]),
    })
    const loaded = loadFromLibrary(unzipKip(bytes))
    expect(loaded.title).toBe('测试故事')
    expect(loaded.version).toBe('1.0.0')
    expect(loaded.story.canContinue).toBe(true)
    expect(loaded.resolveAsset('assets/x.png')).toMatch(/^blob:/)
    expect(loaded.resolveAsset('缺失.png')).toBe('') // 未知资源 → 空串
    expect(loaded.assetUrls).toHaveLength(1)
  })

  it('装配失败（manifest 非法 JSON）→ 抛错', () => {
    const bytes = zipSync({ 'kiny.json': strToU8('not json'), 'main.kin': strToU8(MAIN) })
    expect(() => loadFromLibrary(unzipKip(bytes))).toThrow()
  })
})
