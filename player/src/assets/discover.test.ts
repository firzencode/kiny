import { describe, it, expect } from 'vitest'
import { discoverAssets, familyOf } from './discover'

describe('discoverAssets', () => {
  it('挑出 .css 与字体文件，其余（.kin / 图片 / 音频 / manifest）忽略', () => {
    const r = discoverAssets([
      'main.kin', 'story.kiw', 'assets/bg.jpg', 'assets/bgm.mp3',
      'skin.css', 'fonts/楷体.woff2', 'fonts/a.ttf', 'fonts/b.otf', 'fonts/c.woff',
    ])
    expect(r.css).toEqual(['skin.css'])
    expect(r.fonts).toEqual(['fonts/a.ttf', 'fonts/b.otf', 'fonts/c.woff', 'fonts/楷体.woff2'])
  })

  it('css 按路径字典序（与装配同一比较器；`10-` 前缀可控序）', () => {
    const r = discoverAssets(['20-theme.css', '10-base.css', 'sub/1.css'])
    expect(r.css).toEqual(['10-base.css', '20-theme.css', 'sub/1.css'])
  })

  it('跳过 . 开头的路径段与 node_modules（与 editor 项目扫描一致）', () => {
    const r = discoverAssets(['.hidden/a.css', 'ok/.b.css', 'node_modules/x/y.css', 'sub/node_modules/z.css', 'good.css'])
    expect(r.css).toEqual(['good.css'])
  })

  it('扩展名大小写不敏感', () => {
    const r = discoverAssets(['A.CSS', 'F.WOFF2'])
    expect(r.css).toEqual(['A.CSS'])
    expect(r.fonts).toEqual(['F.WOFF2'])
  })

  it('停用某 css 只需改扩展名', () => {
    expect(discoverAssets(['skin.css.bak']).css).toEqual([])
  })
})

describe('familyOf', () => {
  it('族名 = 文件名去扩展名（去目录）', () => {
    expect(familyOf('fonts/楷体.woff2')).toBe('楷体')
    expect(familyOf('Noto Sans SC.ttf')).toBe('Noto Sans SC')
  })
  it('多点文件名只去最后一段扩展名', () => {
    expect(familyOf('a.b.woff2')).toBe('a.b')
  })
})
