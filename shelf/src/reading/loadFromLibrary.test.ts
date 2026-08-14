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

  it('作品前端资源：css 取文本编译、url() 重写为 objectURL、字体注册 @font-face', () => {
    const bytes = zipSync({
      'kiny.json': strToU8(MANIFEST),
      'main.kin': strToU8(MAIN),
      'theme/skin.css': strToU8('.kin-letter{background:url(paper.png)}'),
      'theme/paper.png': new Uint8Array([1]),
      'fonts/楷体.woff2': new Uint8Array([2]),
    })
    const loaded = loadFromLibrary(unzipKip(bytes))
    expect(loaded.projectCss).toContain('font-family: "楷体"')
    expect(loaded.projectCss).toContain('.kin-letter{background:url("blob:')
    // 三个非 .kin 资源各一个 objectURL（css 自身也在 assets 里）。
    expect(loaded.assetUrls).toHaveLength(3)
  })

  it('无 css / 字体 → projectCss 空串', () => {
    const bytes = zipSync({ 'kiny.json': strToU8(MANIFEST), 'main.kin': strToU8(MAIN) })
    expect(loadFromLibrary(unzipKip(bytes)).projectCss).toBe('')
  })

  it('角色表：`.kip` 里的 characters.json 被解析进角色表', () => {
    const bytes = zipSync({
      'kiny.json': strToU8(MANIFEST),
      'main.kin': strToU8(MAIN),
      'characters.json': strToU8('{"阿黎娅":{"color":"#7fb3d5"}}'),
    })
    expect(loadFromLibrary(unzipKip(bytes)).characters.get('阿黎娅')).toBe('#7fb3d5')
  })

  it('无 / 坏 characters.json → 空表，作品照常装配', () => {
    const none = zipSync({ 'kiny.json': strToU8(MANIFEST), 'main.kin': strToU8(MAIN) })
    expect(loadFromLibrary(unzipKip(none)).characters.size).toBe(0)
    const bad = zipSync({
      'kiny.json': strToU8(MANIFEST),
      'main.kin': strToU8(MAIN),
      'characters.json': strToU8('{坏 json'),
    })
    const loaded = loadFromLibrary(unzipKip(bad))
    expect(loaded.characters.size).toBe(0)
    expect(loaded.story.canContinue).toBe(true)
  })

  it('装配失败（manifest 非法 JSON）→ 抛错', () => {
    const bytes = zipSync({ 'kiny.json': strToU8('not json'), 'main.kin': strToU8(MAIN) })
    expect(() => loadFromLibrary(unzipKip(bytes))).toThrow()
  })
})
