import { describe, it, expect } from 'vitest'
import { scopeCss } from './scopeCss'

const S = '.preview-stage'
const W = ':where(.preview-stage)'

describe('scopeCss —— 基本选择器', () => {
  it('普通选择器加后代前缀', () => {
    expect(scopeCss('.player p { color: red }', S)).toBe(`${W} .player p { color: red }`)
  })

  it('* 加前缀（只作用于容器后代）', () => {
    expect(scopeCss('* { margin: 0 }', S)).toBe(`${W} * { margin: 0 }`)
  })

  it('选择器列表逐条加前缀', () => {
    expect(scopeCss('h1, h2 { margin: 0 }', S)).toBe(`${W} h1, ${W} h2 { margin: 0 }`)
  })

  it(':is() 括号内的逗号不拆', () => {
    expect(scopeCss(':is(h1, h2) { margin: 0 }', S)).toBe(`${W} :is(h1, h2) { margin: 0 }`)
  })

  it('伪元素照常加前缀', () => {
    expect(scopeCss('::selection { background: red }', S)).toBe(`${W} ::selection { background: red }`)
  })

  it('多条规则各自限定', () => {
    expect(scopeCss('p { margin: 0 }\n.kin-letter { color: red }', S))
      .toBe(`${W} p { margin: 0 }\n${W} .kin-letter { color: red }`)
  })
})

describe('scopeCss —— 根选择器映射为容器自身', () => {
  it(':root 映射为容器', () => {
    expect(scopeCss(':root { --kiny-text: #fff }', S)).toBe(`${W} { --kiny-text: #fff }`)
  })

  it('html 映射为容器', () => {
    expect(scopeCss('html { color: red }', S)).toBe(`${W} { color: red }`)
  })

  it('body 映射为容器', () => {
    expect(scopeCss('body { background: red }', S)).toBe(`${W} { background: red }`)
  })

  it('根选择器在后代位置也被替换（否则永不匹配）', () => {
    expect(scopeCss('body .foo { color: red }', S)).toBe(`${W} .foo { color: red }`)
  })

  it('连续的根选择器折叠成一个（html body 就是页面根那一个盒子）', () => {
    expect(scopeCss('html body p { color: red }', S)).toBe(`${W} p { color: red }`)
    expect(scopeCss('html > body { color: red }', S)).toBe(`${W} { color: red }`)
  })

  it('根选择器带子组合器照常限定（容器的子元素确实在预览区内）', () => {
    expect(scopeCss('body > .foo { color: red }', S)).toBe(`${W} > .foo { color: red }`)
  })

  it('注释挡不住兄弟组合器的防御（注释在词法阶段就被丢弃）', () => {
    expect(scopeCss('body/* c */~ .foo { color: red }', S)).toBe(`${W} ${W}/* c */~ .foo { color: red }`)
  })

  it('以兄弟组合器打头的选择器同样退化（顶层本不合法，加一截前缀反倒会变合法）', () => {
    expect(scopeCss('~ .foo { color: red }', S)).toBe(`${W} ${W} ~ .foo { color: red }`)
    expect(scopeCss('.player p, + .foo { color: red }', S))
      .toBe(`${W} .player p, ${W} ${W} + .foo { color: red }`)
  })

  it('根选择器带兄弟组合器不得逃出容器（容器的兄弟是编辑器的预览工具条）', () => {
    // 再套一层前缀 → 「容器内的容器的兄弟」，永不匹配。安全失败胜过命中编辑器界面。
    expect(scopeCss('body ~ .foo { color: red }', S)).toBe(`${W} ${W} ~ .foo { color: red }`)
    expect(scopeCss(':root + .foo { color: red }', S)).toBe(`${W} ${W} + .foo { color: red }`)
  })

  it('根选择器带附加条件', () => {
    expect(scopeCss('body.night { color: red }', S)).toBe(`${W}.night { color: red }`)
  })

  it('选择器列表中间的根选择器', () => {
    expect(scopeCss('.a, body, .b { color: red }', S)).toBe(`${W} .a, ${W}, ${W} .b { color: red }`)
  })

  it('括号内的 html / body 不替换（只在深度 0 处理）', () => {
    expect(scopeCss(':is(html, .x) { color: red }', S)).toBe(`${W} :is(html, .x) { color: red }`)
  })

  it('词边界断在空白处：html 后跟别的类型选择器时只换 html', () => {
    expect(scopeCss('html zzz { color: red }', S)).toBe(`${W} zzz { color: red }`)
  })

  it('类名 / 属性值 / 更长的词里的 body 不误伤', () => {
    expect(scopeCss('.body { color: red }', S)).toBe(`${W} .body { color: red }`)
    expect(scopeCss('[data-x="body"] { color: red }', S)).toBe(`${W} [data-x="body"] { color: red }`)
    expect(scopeCss('.bodyguard { color: red }', S)).toBe(`${W} .bodyguard { color: red }`)
  })
})

describe('scopeCss —— at-rule', () => {
  it('@media 内部递归限定', () => {
    expect(scopeCss('@media (max-width: 600px) { p { margin: 0 } }', S))
      .toBe(`@media (max-width: 600px) { ${W} p { margin: 0 } }`)
  })

  it('@supports 内部递归限定', () => {
    expect(scopeCss('@supports (display: grid) { p { margin: 0 } }', S))
      .toBe(`@supports (display: grid) { ${W} p { margin: 0 } }`)
  })

  it('@layer 块内部递归限定', () => {
    expect(scopeCss('@layer skin { p { margin: 0 } }', S))
      .toBe(`@layer skin { ${W} p { margin: 0 } }`)
  })

  it('嵌套多层 at-rule 逐层递归', () => {
    expect(scopeCss('@media screen { @supports (color: red) { body { color: red } } }', S))
      .toBe(`@media screen { @supports (color: red) { ${W} { color: red } } }`)
  })

  it('@font-face 内部原样不动（族名必须全局）', () => {
    const css = '@font-face { font-family: "楷体"; src: url("a.woff2") }'
    expect(scopeCss(css, S)).toBe(css)
  })

  it('@keyframes 内部原样不动', () => {
    const css = '@keyframes fade { from { opacity: 0 } to { opacity: 1 } }'
    expect(scopeCss(css, S)).toBe(css)
  })

  it('@property 内部原样不动', () => {
    const css = '@property --x { syntax: "<color>"; inherits: false; initial-value: red }'
    expect(scopeCss(css, S)).toBe(css)
  })

  it('@import 被剥离（唯一能把未限定规则带进文档的口子）', () => {
    expect(scopeCss('@import url("x.css");\np { margin: 0 }', S).trim())
      .toBe(`${W} p { margin: 0 }`)
  })

  it('语句式 at-rule 保留', () => {
    expect(scopeCss('@charset "utf-8";\np { margin: 0 }', S))
      .toBe(`@charset "utf-8";\n${W} p { margin: 0 }`)
  })
})

// buildProjectCss 给每份 css 都加一行 `/* 路径 */` 头注释，故**生产输入永远以注释开头**。
// 裸 css 能过不等于生产形状能过：at-rule 的识别必须先跳过前导注释。
describe('scopeCss —— 生产形状（前导注释 + at-rule）', () => {
  const head = '/* /proj/theme.css */\n'

  it('注释后的 @import 照样被剥离', () => {
    expect(scopeCss(`${head}@import url("https://x/y.css");\n.player{color:red}`, S))
      .toBe(`${head}\n${W} .player{color:red}`)
  })

  it('注释后的 @media 仍被识别为 at-rule（而非当成选择器）', () => {
    expect(scopeCss(`${head}@media (max-width: 600px) { .player { font-size: 14px } }`, S))
      .toBe(`${head}@media (max-width: 600px) { ${W} .player { font-size: 14px } }`)
  })

  it('注释后的 @font-face 原样放过', () => {
    const css = `${head}@font-face { font-family: "楷体"; src: url("a.woff2") }`
    expect(scopeCss(css, S)).toBe(css)
  })

  it('规则之间的注释不影响后续 at-rule 识别', () => {
    expect(scopeCss(`${head}.player{color:red}\n/* 手机端 */\n@media screen { p { margin: 0 } }`, S))
      .toBe(`${head}${W} .player{color:red}\n/* 手机端 */\n@media screen { ${W} p { margin: 0 } }`)
  })
})

// 扫描器的词法必须与浏览器一致。不一致处 = 「扫描器以为还在串内 / 块内」的文本被浏览器当作
// 顶层规则解析并生效 —— 未限定的规则就这样进了文档。以下每条都在 Chromium 里实证过会漏。
describe('scopeCss —— 词法必须与浏览器一致', () => {
  /** 产出里不得出现未限定的顶层规则（裸 body/p/* 打头的块）。 */
  const noBareRule = (out: string) => {
    expect(out).not.toMatch(/(^|[};])\s*body\s*\{/)
    expect(out).not.toMatch(/(^|[};])\s*p\s*\{/)
  }

  it('未闭合的字符串在换行处结束（bad-string），其后的规则照常限定', () => {
    const css = '.narration::before {\n  content: "—— ;\n}\nbody { background: #300 }'
    const out = scopeCss(css, S)
    noBareRule(out)
    expect(out).toContain(W)
  })

  it('未加引号的 url() 里的引号不开字符串', () => {
    const css = '.a { background: url(x") }\nbody { background: red }'
    noBareRule(scopeCss(css, S))
  })

  it('未加引号的 url() 里的花括号不参与配对', () => {
    const css = '.a { background: url(x{y) }\nbody { background: red }'
    noBareRule(scopeCss(css, S))
  })

  it('选择器里的转义花括号不当作块起始', () => {
    const css = '.a\\{b { color: red }\nbody { background: red }'
    noBareRule(scopeCss(css, S))
  })

  it('跨行未闭合的引号 url 不吞掉后续规则', () => {
    const css = ".a { background: url('x.png\n}\nbody { background: red }"
    noBareRule(scopeCss(css, S))
  })
})

describe('scopeCss —— 兄弟组合器不得逃出容器（任意复合选择器形态）', () => {
  const escaped = (out: string) => {
    // 逃逸态：前缀后跟「一个复合选择器 + 兄弟组合器」，命中的是容器的兄弟。
    // 安全态是套两截前缀（容器内的容器的兄弟，永不匹配）。
    const once = new RegExp(`^:where\\(\\.preview-stage\\)(?!\\s*:where)[^\\s>,]*\\s*[~+]`)
    return once.test(out.trim())
  }

  it('根选择器带伪类再接兄弟组合器', () => {
    expect(escaped(scopeCss('body:not(.zz) ~ .preview-bar { color: red }', S))).toBe(false)
    expect(escaped(scopeCss(':root:hover + .preview-bar { color: red }', S))).toBe(false)
    expect(escaped(scopeCss('body:nth-child(n) + .preview-bar { color: red }', S))).toBe(false)
  })

  it('根选择器带伪类再接兄弟通配', () => {
    expect(escaped(scopeCss('body:not(.zz) ~ * { color: red }', S))).toBe(false)
  })

  it('根选择器带类 / 属性再接兄弟组合器', () => {
    expect(escaped(scopeCss('body.night ~ .preview-bar { color: red }', S))).toBe(false)
    expect(escaped(scopeCss('body[data-x] + .preview-bar { color: red }', S))).toBe(false)
  })

  it('子组合器与后代组合器照常放行（都落在容器内）', () => {
    expect(scopeCss('body:not(.zz) > .foo { color: red }', S)).toBe(`${W}:not(.zz) > .foo { color: red }`)
    expect(scopeCss('body.night .foo { color: red }', S)).toBe(`${W}.night .foo { color: red }`)
  })
})

describe('scopeCss —— 未知 at-rule 一律丢弃（fail-closed）', () => {
  it('@starting-style 内部递归限定（内部就是普通样式规则）', () => {
    expect(scopeCss('@starting-style { .banner { opacity: 0 } }', S))
      .toBe(`@starting-style { ${W} .banner { opacity: 0 } }`)
  })

  it('未知带块 at-rule 整块丢弃——内部可能承载选择器，限定不了就不能放行', () => {
    expect(scopeCss('@wat foo { p { margin: 0 } }', S)).toBe('')
    expect(scopeCss('.player{color:red}\n@wat foo { body { margin: 0 } }', S))
      .toBe(`${W} .player{color:red}\n`)
  })
})

describe('scopeCss —— 扫描器边界', () => {
  it('注释里的花括号与逗号不参与结构判定', () => {
    expect(scopeCss('/* { } , */ p { margin: 0 }', S)).toBe(`/* { } , */ ${W} p { margin: 0 }`)
  })

  it('声明值里的字符串含花括号不影响配对', () => {
    const css = 'p { content: "}{" }'
    expect(scopeCss(css, S)).toBe(`${W} ${css}`)
  })

  it('CSS 嵌套：只改顶层，嵌套子规则原样（父被限定即整棵子树受限）', () => {
    expect(scopeCss('.player { color: red; & p { margin: 0 } }', S))
      .toBe(`${W} .player { color: red; & p { margin: 0 } }`)
  })

  it('空串 / 纯注释原样', () => {
    expect(scopeCss('', S)).toBe('')
    expect(scopeCss('/* 空主题 */', S)).toBe('/* 空主题 */')
  })

  it('畸形输入不抛错', () => {
    expect(() => scopeCss('p { color: red', S)).not.toThrow()
    expect(() => scopeCss('p { content: "abc', S)).not.toThrow()
    expect(() => scopeCss('} p { color: red }', S)).not.toThrow()
  })

  it('未闭合块仍被限定（不放未限定规则出去）', () => {
    expect(scopeCss('p { color: red', S)).toBe(`${W} p { color: red`)
  })
})
