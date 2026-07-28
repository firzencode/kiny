import { describe, it, expect } from 'vitest'
import { buildProjectCss } from './buildCss'

const resolve = (p: string) => `/base/${p}`

describe('buildProjectCss —— @font-face 生成', () => {
  it('族名 = 文件名去扩展名，一个文件一个族', () => {
    const r = buildProjectCss({ css: [], fonts: ['fonts/楷体.woff2'] }, { readCss: () => '', resolveAsset: resolve })
    expect(r.css).toContain('@font-face')
    expect(r.css).toContain('font-family: "楷体"')
    expect(r.css).toContain('url("/base/fonts/楷体.woff2")')
    expect(r.issues).toEqual([])
  })

  it('按扩展名给出 format() 提示', () => {
    const r = buildProjectCss({ css: [], fonts: ['a.woff2', 'b.ttf', 'c.otf', 'd.woff'] }, { readCss: () => '', resolveAsset: resolve })
    expect(r.css).toContain('format("woff2")')
    expect(r.css).toContain('format("truetype")')
    expect(r.css).toContain('format("opentype")')
    expect(r.css).toContain('format("woff")')
  })

  it('非法族名（含分号等注入字符）忽略并报 issue', () => {
    const r = buildProjectCss({ css: [], fonts: ['a;b.woff2'] }, { readCss: () => '', resolveAsset: resolve })
    expect(r.css).toBe('')
    expect(r.issues).toEqual([{ kind: 'bad-font-name', path: 'a;b.woff2', family: 'a;b' }])
  })

  it('同名族冲突：按路径序后者覆盖 + 报 issue', () => {
    const r = buildProjectCss({ css: [], fonts: ['a/楷体.woff2', 'b/楷体.ttf'] }, { readCss: () => '', resolveAsset: resolve })
    expect(r.css).toContain('url("/base/b/楷体.ttf")')
    expect(r.css).not.toContain('a/楷体.woff2')
    expect(r.issues).toEqual([{ kind: 'font-conflict', path: 'b/楷体.ttf', family: '楷体' }])
  })

  it('URL 里的引号与反斜杠转义（与 css 内 url() 重写同一套，防断出 css 语法）', () => {
    const r = buildProjectCss({ css: [], fonts: ['a.woff2'] }, { readCss: () => '', resolveAsset: () => 'x"y\\z' })
    expect(r.css).toContain('url("x\\"y\\\\z")')
  })

  it('字体文件解析不出 URL（宿主未提供）→ 跳过并报 issue', () => {
    const r = buildProjectCss({ css: [], fonts: ['a.woff2'] }, { readCss: () => '', resolveAsset: () => '' })
    expect(r.css).toBe('')
    expect(r.issues).toEqual([{ kind: 'font-unresolved', path: 'a.woff2', family: 'a' }])
  })
})

describe('buildProjectCss —— css 拼接', () => {
  it('按给定顺序拼接、各自重写 url()，@font-face 在最前', () => {
    const r = buildProjectCss(
      { css: ['10-base.css', 'theme/20-skin.css'], fonts: ['f.ttf'] },
      { readCss: (p) => (p === '10-base.css' ? '.player{color:red}' : 'b{background:url(bg.png)}'), resolveAsset: resolve },
    )
    const fontAt = r.css.indexOf('@font-face')
    const baseAt = r.css.indexOf('.player{color:red}')
    const skinAt = r.css.indexOf('/base/theme/bg.png')
    expect(fontAt).toBeLessThan(baseAt)
    expect(baseAt).toBeLessThan(skinAt)
  })

  it('每段前带来源注释，便于作者在 devtools 里定位', () => {
    const r = buildProjectCss({ css: ['skin.css'], fonts: [] }, { readCss: () => 'a{}', resolveAsset: resolve })
    expect(r.css).toContain('/* skin.css */')
  })

  it('读不到文本的 css 跳过并报 issue', () => {
    const r = buildProjectCss({ css: ['gone.css'], fonts: [] }, { readCss: () => null, resolveAsset: resolve })
    expect(r.css).toBe('')
    expect(r.issues).toEqual([{ kind: 'css-unreadable', path: 'gone.css' }])
  })

  it('无任何资源 → 空串（宿主据此不注入 style）', () => {
    expect(buildProjectCss({ css: [], fonts: [] }, { readCss: () => '', resolveAsset: resolve }).css).toBe('')
  })
})
