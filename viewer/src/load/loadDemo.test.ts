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

  it('多 .kin 文件：并行 fetch、全部加载、Story 建出（每文件仅一趟，Q5）', async () => {
    const main = '开场。\n-> 二\n'
    const two = '=== 二 ===\n第二节。\n-> END\n'
    stubFetch({ '小样.kiw': MANIFEST, 'files.json': '["小样.kiw","main.kin","two.kin"]', 'main.kin': main, 'two.kin': two })
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const out = await loadDemo()
    expect(out.ok).toBe(true)
    // files.json + manifest + 2 个 .kin，各恰一趟（并行不重复抓）。
    expect(fetchSpy).toHaveBeenCalledTimes(4)
    const fetched = fetchSpy.mock.calls.map((c) => (c[0] as string).replace(/^demo\//, ''))
    expect(fetched).toEqual(expect.arrayContaining(['files.json', '小样.kiw', 'main.kin', 'two.kin']))
  })

  it('索引里的 .css 取文本编译进 projectCss，字体注册 @font-face（相对 URL 带 base 前缀）', async () => {
    stubFetch({
      '小样.kiw': MANIFEST,
      'files.json': '["小样.kiw","main.kin","theme/skin.css","fonts/楷体.woff2","assets/bg.jpg"]',
      'main.kin': MAIN,
      'theme/skin.css': '.player{--kiny-page-bg:#fff}.kin-letter{background:url(paper.png)}',
    })
    const out = await loadDemo()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.projectCss).toContain('--kiny-page-bg:#fff')
    expect(out.value.projectCss).toContain('font-family: "楷体"')
    expect(out.value.projectCss).toContain('url("demo/fonts/楷体.woff2")')
    // css 内相对 url() 以该 css 所在目录为基准解析。
    expect(out.value.projectCss).toContain('url("demo/theme/paper.png")')
    // 图片 / 字体不作文本 fetch（只 css 与 .kin 取文本）。
    const fetched = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string)
    expect(fetched).not.toContain('demo/assets/bg.jpg')
    expect(fetched).not.toContain('demo/fonts/楷体.woff2')
  })

  it('某个 css 取不到（404）→ 故事照常加载，只是少那一段样式', async () => {
    stubFetch({
      '小样.kiw': MANIFEST,
      'files.json': '["小样.kiw","main.kin","gone.css","ok.css"]',
      'main.kin': MAIN,
      'ok.css': '.player{color:red}',
      // gone.css 不在表里 → fetch 返回 !ok → text() 抛错
    })
    const out = await loadDemo()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.story.canContinue).toBe(true)
    expect(out.value.projectCss).toContain('color:red')
  })

  it('无 css / 字体的项目 → projectCss 为空串（不注入 style）', async () => {
    stubFetch({ '小样.kiw': MANIFEST, 'files.json': '["小样.kiw","main.kin"]', 'main.kin': MAIN })
    const out = await loadDemo()
    expect(out.ok && out.value.projectCss).toBe('')
  })

  it('manifest 非法 → 返回 ok:false 带消息', async () => {
    stubFetch({ 'kiny.json': 'not json', 'files.json': '["kiny.json"]' })
    const out = await loadDemo()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toMatch(/JSON/)
  })
})
