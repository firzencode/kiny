import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { unzipKip } from './unzipKip'

const MANIFEST = JSON.stringify({ name: '测试故事', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
const MAIN = '开场。\n-> END\n'

describe('unzipKip', () => {
  it('解出 manifest + kin 文本 + 资源 Blob', () => {
    const bytes = zipSync({
      'kiny.json': strToU8(MANIFEST),
      'main.kin': strToU8(MAIN),
      'assets/x.png': new Uint8Array([1, 2, 3]),
    })
    const out = unzipKip(bytes)
    expect(out.manifestName).toBe('kiny.json')
    expect(out.manifestText).toContain('测试故事')
    expect(out.kinFiles.get('main.kin')).toContain('开场')
    expect(out.assets.get('assets/x.png')).toBeInstanceOf(Blob)
    expect(out.kinFiles.has('kiny.json')).toBe(false) // manifest 不混入 kinFiles
  })

  it('缺 manifest（无 .kiw / kiny.json）→ 抛错', () => {
    const bytes = zipSync({ 'main.kin': strToU8(MAIN) })
    expect(() => unzipKip(bytes)).toThrow()
  })

  it('非法 zip 字节 → 抛错', () => {
    expect(() => unzipKip(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })
})
