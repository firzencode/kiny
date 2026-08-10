import { describe, it, expect } from 'vitest'
import { scanThemeCss, setTokenValue } from './scan'

/** 便捷：扫出来的 token → { 名: 值 } */
function tokens(css: string): Record<string, string> {
  const r = scanThemeCss(css)
  if (!r.ok) throw new Error(`扫描失败: ${r.reason}`)
  return Object.fromEntries(r.tokens.map((t) => [t.name, t.value]))
}

describe('scanThemeCss', () => {
  it('抓出 .player 块内的 --kiny-* 声明及其值区间', () => {
    const css = '.player {\n  --kiny-page-bg: #123456;\n}\n'
    const r = scanThemeCss(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens).toHaveLength(1)
    const t = r.tokens[0]
    expect(t.name).toBe('--kiny-page-bg')
    expect(t.value).toBe('#123456')
    expect(css.slice(t.valueStart, t.valueEnd)).toBe('#123456') // 区间精确落在值上
  })

  it('注释里的假声明不算数', () => {
    const css = `.player {
  /* --kiny-page-bg: #000000; 这是说明，不是声明 */
  --kiny-text: #eeeeee;
}
`
    expect(tokens(css)).toEqual({ '--kiny-text': '#eeeeee' })
  })

  it('值里含引号串（字体族）照样完整取到', () => {
    const css = '.player {\n  --kiny-prose-font: "思源宋体", "Noto Serif SC", serif;\n}\n'
    expect(tokens(css)['--kiny-prose-font']).toBe('"思源宋体", "Noto Serif SC", serif')
  })

  it('引号串里的分号不被当作声明结束', () => {
    const css = `.player {\n  --kiny-prose-font: "a;b", serif;\n  --kiny-text: #fff;\n}\n`
    expect(tokens(css)).toEqual({ '--kiny-prose-font': '"a;b", serif', '--kiny-text': '#fff' })
  })

  it('同一 token 重复声明 → 以最后一条为准（层叠结果就是它）', () => {
    const css = '.player {\n  --kiny-text: #111;\n  --kiny-text: #222;\n}\n'
    const r = scanThemeCss(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens).toHaveLength(1)
    expect(r.tokens[0].value).toBe('#222')
    expect(css.slice(r.tokens[0].valueStart, r.tokens[0].valueEnd)).toBe('#222')
  })

  it('只认 .player 块：:root 或别的选择器里的同名 token 不进 GUI', () => {
    const css = ':root {\n  --kiny-text: #aaa;\n}\n.player {\n  --kiny-text: #bbb;\n}\n'
    expect(tokens(css)).toEqual({ '--kiny-text': '#bbb' })
  })

  it('多个 .player 块都算（后者的同名 token 覆盖前者）', () => {
    const css = '.player {\n  --kiny-text: #111;\n}\n.player {\n  --kiny-text: #333;\n}\n'
    expect(tokens(css)).toEqual({ '--kiny-text': '#333' })
  })

  it('`.player .foo` 这种后代选择器不是 token 容器', () => {
    const css = '.player .panel-bottom {\n  --kiny-text: #111;\n  background: #000;\n}\n'
    expect(tokens(css)).toEqual({})
  })

  it('没有 .player 块 → 成功但零 token（GUI 可用，写回时补建块）', () => {
    const r = scanThemeCss('/* 空主题 */\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens).toEqual([])
  })

  it('花括号不配对（残缺文件）→ 解析失败，GUI 须放弃、提示切原文', () => {
    const r = scanThemeCss('.player {\n  --kiny-text: #111;\n')
    expect(r.ok).toBe(false)
  })

  it('注释未闭合 → 解析失败', () => {
    const r = scanThemeCss('.player { }\n/* 没关掉\n')
    expect(r.ok).toBe(false)
  })

  it('GUI 未覆盖的内容计数：非 token 声明与其它规则块各算一处', () => {
    const css = `.player {
  --kiny-text: #111;
  letter-spacing: .05em;
}
.player .panel-bottom { background: #000; }
@media (max-width: 600px) { .player { --kiny-prose-size: 1rem; } }
`
    const r = scanThemeCss(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // .player 内的 letter-spacing 一处 + .player .panel-bottom 一处 + @media 一处
    expect(r.uncoveredCount).toBe(3)
  })

  it('选择器里夹注释、或写成逗号组，仍认得出是 .player 块', () => {
    expect(tokens('.player /* 主题 */ {\n  --kiny-text: #111;\n}\n')).toEqual({ '--kiny-text': '#111' })
    expect(tokens('.player, .preview-root {\n  --kiny-text: #222;\n}\n')).toEqual({ '--kiny-text': '#222' })
  })

  it('值后带行内注释：值区间只到值本身，注释一个字都不动', () => {
    const css = '.player {\n  --kiny-text: #111 /* a /* b */;\n}\n'
    const r = scanThemeCss(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens[0].value).toBe('#111')
    // 关键：改值不得吞掉注释里的任何字符
    expect(setTokenValue(css, '--kiny-text', '#222')).toBe(css.replace('#111', '#222'))
  })

  it('别处选择器里的换肤变量单独计数（GUI 改的可能被它们盖过）', () => {
    const css = `html .player {
  --kiny-text: #aaa;
  --kiny-page-bg: #000;
}
.player {
  --kiny-text: #bbb;
}
`
    const r = scanThemeCss(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.foreignTokenCount).toBe(2)
  })

  it('没有别处的换肤变量时计数为 0', () => {
    const r = scanThemeCss('.player {\n  --kiny-text: #111;\n}\n.player .x { color: red; }\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.foreignTokenCount).toBe(0)
  })

  it('顶层 .player 块内的 --kiny-* 才算；未知 --other-* 自定义属性归入未覆盖', () => {
    const css = '.player {\n  --kiny-text: #111;\n  --my-own: 3px;\n}\n'
    const r = scanThemeCss(css)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tokens.map((t) => t.name)).toEqual(['--kiny-text'])
    expect(r.uncoveredCount).toBe(1)
  })
})

describe('setTokenValue（定点替换）', () => {
  const css = `/* 我的主题 —— 别动我的注释 */

.player {
  --kiny-page-bg: #0d1117;   /* 页面底色 */
  --kiny-text: #e8e8e8;
}

/* 尾注 */
`

  it('只替换目标值区间，文件其余部分逐字不变（核心不变量）', () => {
    const next = setTokenValue(css, '--kiny-page-bg', '#ffffff')
    expect(next).toBe(css.replace('#0d1117', '#ffffff'))
    // 逐字校验：把改动处还原后应与原文完全相同
    expect(next.replace('#ffffff', '#0d1117')).toBe(css)
  })

  it('改一个 token 不动另一个', () => {
    const next = setTokenValue(css, '--kiny-text', '#000000')
    expect(next).toContain('--kiny-page-bg: #0d1117;')
    expect(next).toContain('--kiny-text: #000000;')
  })

  it('文件里没有该 token → 追加进已有 .player 块，其余逐字不变', () => {
    const next = setTokenValue(css, '--kiny-prose-size', '1.2rem')
    expect(next).toContain('--kiny-prose-size: 1.2rem;')
    expect(next.startsWith('/* 我的主题 —— 别动我的注释 */')).toBe(true)
    expect(next).toContain('/* 尾注 */')
    expect(next).toContain('--kiny-page-bg: #0d1117;   /* 页面底色 */')
    // 追加后仍可被扫回来
    expect(tokens(next)['--kiny-prose-size']).toBe('1.2rem')
  })

  it('文件里没有 .player 块 → 末尾补一个块，原内容逐字保留', () => {
    const plain = '/* 只有注释 */\n'
    const next = setTokenValue(plain, '--kiny-text', '#fff')
    expect(next.startsWith(plain)).toBe(true)
    expect(tokens(next)).toEqual({ '--kiny-text': '#fff' })
  })

  it('重复声明时改的是最后一条（与层叠结果一致）', () => {
    const dup = '.player {\n  --kiny-text: #111;\n  --kiny-text: #222;\n}\n'
    const next = setTokenValue(dup, '--kiny-text', '#333')
    expect(next).toBe('.player {\n  --kiny-text: #111;\n  --kiny-text: #333;\n}\n')
  })

  it('末条声明省了分号（扫描器接受的写法）→ 追加前先补上分号，不吞掉它', () => {
    const noSemi = '/* 我的主题 */\n.player {\n  --kiny-page-bg: #0d1117;\n  --kiny-text: #e8e8e8\n}\n'
    const next = setTokenValue(noSemi, '--kiny-prose-size', '1.1rem')
    // 两条都还在、都取得到，且新加的那条是独立声明而非被吞进上一条的值
    expect(tokens(next)).toEqual({
      '--kiny-page-bg': '#0d1117', '--kiny-text': '#e8e8e8', '--kiny-prose-size': '1.1rem',
    })
  })

  it('末条声明省分号且带行内注释 → 注释一个字不动', () => {
    const noSemi = '.player {\n  --kiny-error: #f00 /* 别删我 */\n}\n'
    const next = setTokenValue(noSemi, '--kiny-text', '#fff')
    expect(next).toContain('/* 别删我 */')
    expect(tokens(next)).toEqual({ '--kiny-error': '#f00', '--kiny-text': '#fff' })
  })

  it('单行块 `.player { --kiny-text: red }` 追加后仍是合法声明', () => {
    const next = setTokenValue('.player { --kiny-text: red }\n', '--kiny-page-bg', '#fff')
    expect(tokens(next)).toEqual({ '--kiny-text': 'red', '--kiny-page-bg': '#fff' })
  })

  it('末条是非 token 声明且省分号 → 同样先补分号，它的值不被污染', () => {
    const next = setTokenValue('.player {\n  letter-spacing: .05em\n}\n', '--kiny-text', '#fff')
    expect(next).toContain('letter-spacing: .05em;')
    expect(tokens(next)).toEqual({ '--kiny-text': '#fff' })
  })

  it('解析不了的文件 → 原样返回，绝不猜着写坏作者的文件', () => {
    const broken = '.player {\n  --kiny-text: #111;\n'
    expect(setTokenValue(broken, '--kiny-text', '#222')).toBe(broken)
  })

  it('批量改多个 token：逐次调用互不串位（区间随文本长度变化重算）', () => {
    let next = css
    next = setTokenValue(next, '--kiny-page-bg', '#fffffffff')
    next = setTokenValue(next, '--kiny-text', '#0')
    expect(tokens(next)).toEqual({ '--kiny-page-bg': '#fffffffff', '--kiny-text': '#0' })
    expect(next).toContain('/* 页面底色 */')
    expect(next).toContain('/* 尾注 */')
  })
})
