import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadDemo } from './loadDemo'

const MANIFEST = JSON.stringify({ name: '小样', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
const MAIN = `开场。
-> END
`

/** 把 fetch 桩成一个内存文件表。 */
function stubFetch(files: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = url.replace(/^demo\//, '')
    if (!(key in files)) return { ok: false, text: async () => '' } as Response
    return { ok: true, text: async () => files[key] } as Response
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('loadDemo', () => {
  it('收集文本 → 建出可玩 Story', async () => {
    stubFetch({ 'kiny.json': MANIFEST, 'files.json': '["main.kin"]', 'main.kin': MAIN })
    const out = await loadDemo()
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.title).toBe('小样')
      expect(out.value.assetBase).toBe('demo/')
      expect(out.value.story.canContinue).toBe(true)
    }
  })

  it('manifest 非法 → 返回 ok:false 带消息', async () => {
    stubFetch({ 'kiny.json': 'not json', 'files.json': '[]' })
    const out = await loadDemo()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toMatch(/JSON/)
  })
})
