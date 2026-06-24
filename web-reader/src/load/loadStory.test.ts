import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadStory } from './loadStory'

const MANIFEST = JSON.stringify({ name: '内联故事', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' })
const MAIN = `开场。
-> END
`

/** 把 fetch 桩成一个内存文件表（仅 demo/ 回退分支用）。 */
function stubFetch(files: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = url.replace(/^demo\//, '')
    if (!(key in files)) return { ok: false, text: async () => '' } as Response
    return { ok: true, text: async () => files[key] } as Response
  }))
}

afterEach(() => {
  delete (window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__
  vi.unstubAllGlobals()
})

describe('loadStory', () => {
  it('有内联 __KINY_PROJECT__ → 用内联数据建 Story，assetBase 默认空（资源名自带 assets/）', async () => {
    ;(window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__ = {
      manifest: MANIFEST,
      files: { 'main.kin': MAIN },
    }
    const out = await loadStory(123)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.title).toBe('内联故事')
      expect(out.value.assetBase).toBe('')
      expect(out.value.story.canContinue).toBe(true)
    }
  })

  it('内联数据可自定义 assetBase', async () => {
    ;(window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__ = {
      manifest: MANIFEST,
      files: { 'main.kin': MAIN },
      assetBase: 'media/',
    }
    const out = await loadStory(1)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.assetBase).toBe('media/')
  })

  it('内联 manifest 非法 → ok:false 带消息', async () => {
    ;(window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__ = {
      manifest: 'not json',
      files: {},
    }
    const out = await loadStory(1)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toMatch(/JSON/)
  })

  it('无内联数据 → 回退 fetch demo（assetBase demo/）', async () => {
    stubFetch({ 'kiny.json': MANIFEST, 'files.json': '["main.kin"]', 'main.kin': MAIN })
    const out = await loadStory(1)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.assetBase).toBe('demo/')
  })

  it('占位字符串（导出模板未注入数据）→ 当作无内联，回退 fetch', async () => {
    ;(window as unknown as { __KINY_PROJECT__?: unknown }).__KINY_PROJECT__ = '__KINY_PROJECT_DATA__'
    stubFetch({ 'kiny.json': MANIFEST, 'files.json': '["main.kin"]', 'main.kin': MAIN })
    const out = await loadStory(1)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.assetBase).toBe('demo/')
  })
})
