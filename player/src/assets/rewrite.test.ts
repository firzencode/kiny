import { describe, it, expect } from 'vitest'
import { resolveRelative, rewriteCssUrls } from './rewrite'

const resolve = (p: string) => `/base/${p}`

describe('resolveRelative', () => {
  it('以 css 文件所在目录为基准解析', () => {
    expect(resolveRelative('theme/skin.css', 'img/a.png')).toBe('theme/img/a.png')
  })
  it('根部 css 的相对路径即项目根相对', () => {
    expect(resolveRelative('skin.css', 'assets/a.png')).toBe('assets/a.png')
  })
  it('处理 ./ 与 ../', () => {
    expect(resolveRelative('theme/sub/skin.css', '../img/a.png')).toBe('theme/img/a.png')
    expect(resolveRelative('theme/skin.css', './a.png')).toBe('theme/a.png')
    expect(resolveRelative('theme/skin.css', '../../a.png')).toBe('a.png')
  })
})

describe('rewriteCssUrls', () => {
  it('相对 url() 重写为宿主解析后的 URL（无引号 / 单引号 / 双引号三种写法）', () => {
    const css = `a{background:url(img/a.png)}b{background:url('img/b.png')}c{background:url("img/c.png")}`
    expect(rewriteCssUrls(css, 'theme/skin.css', resolve)).toBe(
      `a{background:url("/base/theme/img/a.png")}b{background:url("/base/theme/img/b.png")}c{background:url("/base/theme/img/c.png")}`,
    )
  })

  it('url 内外空白容忍', () => {
    expect(rewriteCssUrls('a{ background : url(  a.png  ) }', 'skin.css', resolve))
      .toBe('a{ background : url("/base/a.png") }')
  })

  it('data: / http(s): / 协议相对 / 绝对路径 / blob: 原样不动', () => {
    const css = [
      'url(data:font/woff2;base64,AAA)',
      'url(https://x/y.png)',
      'url(http://x/y.png)',
      'url(//x/y.png)',
      'url(/y.png)',
      'url(blob:abc)',
      'url(#frag)',
    ].join(' ')
    expect(rewriteCssUrls(css, 'skin.css', resolve)).toBe(css)
  })

  it('@font-face 的 src url 同样重写', () => {
    const css = `@font-face{font-family:"楷体";src:url(../fonts/楷体.woff2) format("woff2")}`
    expect(rewriteCssUrls(css, 'theme/skin.css', resolve))
      .toBe(`@font-face{font-family:"楷体";src:url("/base/fonts/楷体.woff2") format("woff2")}`)
  })

  it('解析不到（宿主返回空串）时保留原写法，不产出 url("")', () => {
    expect(rewriteCssUrls('a{background:url(missing.png)}', 'skin.css', () => ''))
      .toBe('a{background:url(missing.png)}')
  })

  it('结果 URL 里的引号与反斜杠转义（防 css 注入 / 破坏语法）', () => {
    expect(rewriteCssUrls('a{background:url(x.png)}', 'skin.css', () => 'a"b\\c'))
      .toBe('a{background:url("a\\"b\\\\c")}')
  })
})
