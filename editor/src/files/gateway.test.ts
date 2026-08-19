import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildProjectCss } from '@kiny/player'
import {
  defaultKipName,
  defaultWebpageDirName,
  buildProjectData,
  starterManifest,
  sanitizeProjectBase,
  projectFolderName,
  assertRenameSafe,
  isTextFile,
  normalizeNewFileName,
  starterContentFor,
  isThemeFile,
  STARTER_NEW_FILE,
  STARTER_THEME_CSS,
  STARTER_STYLE_CSS,
  type Manifest,
} from './gateway'

describe('assertRenameSafe（两 gateway 共享的 renamePath 前置守卫）', () => {
  it('合法改名不抛', () => {
    expect(() => assertRenameSafe('a/x.kin', 'a/y.kin')).not.toThrow()
    expect(() => assertRenameSafe('sub', 'renamed')).not.toThrow()
  })
  it('非法路径（.. 穿越 / 绝对 / 空）抛', () => {
    expect(() => assertRenameSafe('../x', 'y')).toThrow()
    expect(() => assertRenameSafe('x', '/abs')).toThrow()
    expect(() => assertRenameSafe('', 'y')).toThrow()
  })
  it('目标是源自身或源子树 → 抛「不能移入自身」', () => {
    expect(() => assertRenameSafe('a', 'a')).toThrow('不能移入自身')
    expect(() => assertRenameSafe('a', 'a/b')).toThrow('不能移入自身')
  })
})

describe('defaultKipName', () => {
  it('正常故事名加 .kip 后缀', () => {
    expect(defaultKipName('雾港之夜')).toBe('雾港之夜.kip')
  })
  it('过滤 Windows 文件名非法字符', () => {
    expect(defaultKipName('a/b:c*?"<>|\\d')).toBe('abcd.kip')
  })
  it('空名或全非法字符回退为 story', () => {
    expect(defaultKipName('   ')).toBe('story.kip')
    expect(defaultKipName('/\\:*?')).toBe('story.kip')
  })
})

describe('defaultWebpageDirName', () => {
  it('故事名加 -web 后缀', () => {
    expect(defaultWebpageDirName('雾港之夜')).toBe('雾港之夜-web')
  })
  it('过滤 Windows 文件名非法字符', () => {
    expect(defaultWebpageDirName('a/b:c*?"<>|\\d')).toBe('abcd-web')
  })
  it('空名回退为 story-web', () => {
    expect(defaultWebpageDirName('   ')).toBe('story-web')
  })
})

describe('buildProjectData', () => {
  const manifest: Manifest = { name: '雾港', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }

  it('组装 manifest 文本 + 各 .kin 源码，assetBase 空', () => {
    const json = buildProjectData(manifest, [
      { path: 'main.kin', source: '开场\n-> 末' },
      { path: '末.kin', source: '=== 末 ===\n-> END' },
    ])
    const data = JSON.parse(json) as { manifest: string; files: Record<string, string>; assetBase: string }
    expect(JSON.parse(data.manifest)).toEqual(manifest)
    expect(data.files).toEqual({ 'main.kin': '开场\n-> 末', '末.kin': '=== 末 ===\n-> END' })
    expect(data.assetBase).toBe('')
  })

  it('转义 < > & 防止 .kin 文本里的 </script> 截断内联脚本（仍为合法 JSON、可往返）', () => {
    const json = buildProjectData(manifest, [{ path: 'main.kin', source: '教程：写 </script> 与 a<b & c>d' }])
    // 原始字节不得含闭合标签或裸 < & >，否则注入 index.html 的 <script> 被提前截断
    expect(json).not.toContain('</script>')
    expect(json).not.toContain('<')
    expect(json).not.toContain('>')
    expect(json).toContain('\\u003c')
    // \uXXXX 是合法 JSON 转义，往返还原原文
    const data = JSON.parse(json) as { files: Record<string, string> }
    expect(data.files['main.kin']).toBe('教程：写 </script> 与 a<b & c>d')
  })

  it('只收 .kin：作品前端资源（css 等）不进故事文件表，走 css 字段内联', () => {
    const json = buildProjectData(
      manifest,
      [{ path: 'main.kin', source: '开场' }, { path: 'theme/skin.css', source: '.player{}' }],
      '@font-face{}',
    )
    const data = JSON.parse(json) as { files: Record<string, string>; css: string }
    expect(Object.keys(data.files)).toEqual(['main.kin'])
    expect(data.css).toBe('@font-face{}')
  })
})

describe('isTextFile', () => {
  it('.kin 与作品前端文本资源可编辑', () => {
    for (const p of ['main.kin', 'theme/skin.css', 'a.js', 'x.json', 'r.txt', 'r.md', 'p.html', 'A.CSS']) {
      expect(isTextFile(p), p).toBe(true)
    }
  })
  it('二进制（图 / 音 / 字体）不可编辑', () => {
    for (const p of ['assets/x.png', 'a.mp3', 'fonts/楷体.woff2', 'b.ttf', 'noext']) {
      expect(isTextFile(p), p).toBe(false)
    }
  })
})

describe('normalizeNewFileName（新建文件名归一：按已知文本扩展名分派）', () => {
  it('无扩展名 → 补 .kin（多数写作场景手感不变）', () => {
    expect(normalizeNewFileName(' 第二章 ')).toBe('第二章.kin')
    expect(normalizeNewFileName('chapters/new')).toBe('chapters/new.kin')
  })
  it('已带已知文本扩展名 → 尊重之，不再吞成 .kin', () => {
    expect(normalizeNewFileName('theme.css')).toBe('theme.css')
    expect(normalizeNewFileName('notes.md')).toBe('notes.md')
    expect(normalizeNewFileName('data.json')).toBe('data.json')
    expect(normalizeNewFileName('main.kin')).toBe('main.kin')
  })
  it('扩展名大小写不敏感（同 isTextFile 口径），且归一为小写', () => {
    expect(normalizeNewFileName('THEME.CSS')).toBe('THEME.css')
  })
  it('大写 .KIN 归一成 .kin：否则建出的是引擎永不加载的哑文件', () => {
    expect(normalizeNewFileName('第二章.KIN')).toBe('第二章.kin')
  })
  it('未知扩展名仍补 .kin', () => {
    expect(normalizeNewFileName('第一章.v2')).toBe('第一章.v2.kin')
  })
  it('空名抛错，非法路径抛错', () => {
    expect(() => normalizeNewFileName('   ')).toThrow(/不能为空/)
    expect(() => normalizeNewFileName('../escape.css')).toThrow('非法路径')
  })
})

describe('isThemeFile（哪个文件是作品主题——「外观」GUI 与主题模板共用的单点判定）', () => {
  it('约定名 theme.css，文件名不分大小写', () => {
    expect(isThemeFile('theme.css')).toBe(true)
    expect(isThemeFile('Theme.CSS')).toBe(true)
  })
  it('子目录里的同名文件也算', () => {
    expect(isThemeFile('styles/theme.css')).toBe(true)
  })
  it('别的 .css 不算（它们只是叠加上去的样式，开 GUI 会盖死主题）', () => {
    expect(isThemeFile('skin.css')).toBe(false)
    expect(isThemeFile('zz-panel.css')).toBe(false)
    expect(isThemeFile('my-theme.css')).toBe(false)
    expect(isThemeFile('theme.css.bak')).toBe(false)
  })
  it('目录名叫 theme.css 也不会误判成文件（判的是末段全名）', () => {
    expect(isThemeFile('theme.css/inner.css')).toBe(false)
  })
})

describe('starterContentFor（新建文件起始内容按类型分派）', () => {
  it('.kin 落故事脚手架', () => {
    expect(starterContentFor('chapters/new.kin')).toBe(STARTER_NEW_FILE)
  })
  it('theme.css 落主题模板（文件名大小写不敏感）', () => {
    expect(starterContentFor('theme.css')).toBe(STARTER_THEME_CSS)
    expect(starterContentFor('THEME.css')).toBe(STARTER_THEME_CSS)
  })
  it('其它 .css 落样式空壳，不含任何 token 赋值', () => {
    // 零目录约定下全部 .css 按字典序叠加：第二个文件若也带整份 token 默认值，
    // 会把作者在 theme.css 里调好的主题静默打回默认。
    expect(starterContentFor('styles/10-panel.css')).toBe(STARTER_STYLE_CSS)
    const live = STARTER_STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '') // 剥注释后剩下的才是真生效的声明
    expect(live).not.toMatch(/--kiny-[\w-]+\s*:/)
  })
  it('其它文本类型为空', () => {
    expect(starterContentFor('notes.md')).toBe('')
    expect(starterContentFor('data.json')).toBe('')
  })
})

describe('STARTER_THEME_CSS（新建项目内置主题模板）', () => {
  /** 从一段 css 的指定规则块里抓 `--kiny-*: 值;` 声明（先剥注释，免把注释里的示范声明当真）。 */
  function tokensOf(raw: string, selector: string): Record<string, string> {
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    const start = css.indexOf(selector)
    if (start === -1) throw new Error(`找不到规则块 ${selector}`)
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', open)
    const body = css.slice(open + 1, close)
    const out: Record<string, string> = {}
    for (const m of body.matchAll(/(--kiny-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
    return out
  }

  it('以 .player 为根（不用 :root），免样式漏到 editor 界面', () => {
    expect(STARTER_THEME_CSS).toContain('.player {')
    expect(STARTER_THEME_CSS).not.toContain(':root')
  })

  it('列出的 token 名与默认值同 player 的 :root 一致（防漂移）', () => {
    // vitest 的 cwd 恒为 editor/（package 根），故按仓库布局取同级 player 的样式真相源。
    const playerCss = readFileSync(resolve(process.cwd(), '../player/src/styles.css'), 'utf8')
    const defaults = tokensOf(playerCss, ':root')
    const template = tokensOf(STARTER_THEME_CSS, '.player')
    expect(Object.keys(template).length).toBeGreaterThan(0)
    for (const [name, value] of Object.entries(template)) {
      expect(defaults, `模板 token ${name} 不在 player 的 :root 契约里`).toHaveProperty(name)
      expect(value, `模板 token ${name} 的默认值与 player 漂移`).toBe(defaults[name])
    }
  })

  it('能被 buildProjectCss 编译且零 issue', () => {
    const { css, issues } = buildProjectCss(
      { css: ['theme.css'], fonts: [] },
      { readCss: (p) => (p === 'theme.css' ? STARTER_THEME_CSS : null), resolveAsset: () => '' },
    )
    expect(issues).toEqual([])
    expect(css).toContain('--kiny-page-bg')
  })
})

describe('sanitizeProjectBase', () => {
  it('去非法字符与首尾空白，可为空', () => {
    expect(sanitizeProjectBase(' 雾港/夜 ')).toBe('雾港夜')
    expect(sanitizeProjectBase('  /:*?  ')).toBe('')
  })
})

describe('projectFolderName', () => {
  it('sanitize 结果非空时原样返回', () => {
    expect(projectFolderName(' 雾港/夜 ')).toBe('雾港夜')
  })
  it('sanitize 后为空 → 回退 project', () => {
    expect(projectFolderName('  /:*?  ')).toBe('project')
  })
})

describe('starterManifest', () => {
  it('engine 取注入的 Kiny 版本', () => {
    expect(starterManifest('我的故事').engine).toBe(__KINY_VERSION__)
  })

  it('带作品稳定 id：32 位十六进制，每次新建各不相同', () => {
    const a = starterManifest('我的故事')
    const b = starterManifest('我的故事')
    expect(a.id).toMatch(/^[0-9a-f]{32}$/)
    expect(a.id).not.toBe(b.id)
  })
})
