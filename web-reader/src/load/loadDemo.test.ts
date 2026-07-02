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
  it('.kiw 索引：从 files.json 挑 <名>.kiw 建出可玩 Story', async () => {
    stubFetch({ '小样.kiw': MANIFEST, 'files.json': '["小样.kiw","main.kin"]', 'main.kin': MAIN })
    const out = await loadDemo()
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.title).toBe('小样')
      expect(out.value.assetBase).toBe('demo/')
      expect(out.value.story.canContinue).toBe(true)
    }
  })

  it('旧 kiny.json 索引：fallback 定位 kiny.json', async () => {
    stubFetch({ 'kiny.json': MANIFEST, 'files.json': '["kiny.json","main.kin"]', 'main.kin': MAIN })
    const out = await loadDemo()
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.title).toBe('小样')
  })

  it('索引缺 manifest（无 .kiw 无 kiny.json）→ ok:false', async () => {
    stubFetch({ 'files.json': '["main.kin"]', 'main.kin': MAIN })
    const out = await loadDemo()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('.kiw')
  })

  it('manifest 非法 → 返回 ok:false 带消息', async () => {
    stubFetch({ 'kiny.json': 'not json', 'files.json': '["kiny.json"]' })
    const out = await loadDemo()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toMatch(/JSON/)
  })
})
