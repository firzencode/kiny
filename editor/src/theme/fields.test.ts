import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { THEME_FIELDS, FIELD_DEFAULTS, FIELD_NAMES, PRIMARY_GROUPS, defaultValueOf, toHexColor, toNumber } from './fields'
import { STARTER_THEME_CSS } from '../files/gateway'
import { scanThemeCss } from './scan'

describe('FIELD_DEFAULTS 防漂移', () => {
  /** 从一段 css 的指定规则块里抓 `--kiny-*: 值;`（先剥注释，免把注释里的示范声明当真）。 */
  function tokensOf(raw: string, selector: string): Record<string, string> {
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    const open = css.indexOf('{', css.indexOf(selector))
    const body = css.slice(open + 1, css.indexOf('}', open))
    return Object.fromEntries([...body.matchAll(/(--kiny-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  }

  /** vitest 的 cwd 恒为 editor/（package 根），故按仓库布局取同级 player 的样式真相源。 */
  const playerRoot = () => tokensOf(readFileSync(resolve(process.cwd(), '../player/src/styles.css'), 'utf8'), ':root')

  it('每个 GUI 字段都有默认值，且与 player 的 :root 逐项一致', () => {
    const root = playerRoot()
    for (const f of THEME_FIELDS) {
      expect(FIELD_DEFAULTS, `字段 ${f.name} 缺默认值`).toHaveProperty(f.name)
      expect(FIELD_DEFAULTS[f.name], `字段 ${f.name} 的默认值与 player 漂移`).toBe(root[f.name])
    }
  })

  it('**默认 css 里能调的，GUI 里都能调**：player :root 的每个 token 都有对应字段', () => {
    for (const name of Object.keys(playerRoot())) {
      expect(FIELD_NAMES, `player 有 ${name} 而 GUI 没有对应控件`).toContain(name)
    }
  })

  it('GUI 不多出 player 没有的字段（免得写进文件却无人消费）', () => {
    const root = playerRoot()
    for (const f of THEME_FIELDS) expect(root, `GUI 有 ${f.name} 而 player 没有`).toHaveProperty(f.name)
  })

  it('新建项目内置的 theme.css 模板覆盖常驻分组（打开即有得调；进阶项留给 GUI 显示默认值）', () => {
    const scan = scanThemeCss(STARTER_THEME_CSS)
    expect(scan.ok).toBe(true)
    if (!scan.ok) return
    const inTemplate = new Set(scan.tokens.map((t) => t.name))
    for (const f of THEME_FIELDS.filter((x) => PRIMARY_GROUPS.includes(x.group))) {
      expect(inTemplate, `模板缺 ${f.name}`).toContain(f.name)
    }
    // 模板不写进阶项：十几行 rgba 会吓退作者，GUI 会照 player 默认值呈现它们
    expect(inTemplate.size).toBe(THEME_FIELDS.filter((x) => PRIMARY_GROUPS.includes(x.group)).length)
    expect(scan.uncoveredCount).toBe(0)
    expect(scan.foreignTokenCount).toBe(0)
  })

  it('defaultValueOf：面板类按当前正文色推导出实际颜色，而非塞一串 color-mix', () => {
    expect(defaultValueOf('--kiny-panel-text', '#e8e8e8')).toBe('rgba(232, 232, 232, .62)')
    expect(defaultValueOf('--kiny-panel-border', '#2f2822')).toBe('rgba(47, 40, 34, .12)')
    // 正文色本身表达不了 → 回退 player 原样的函数式（控件随之退化为文本输入）
    expect(defaultValueOf('--kiny-panel-text', 'var(--x)')).toBe(FIELD_DEFAULTS['--kiny-panel-text'])
    // 非推导项照旧取 player 默认值
    expect(defaultValueOf('--kiny-page-bg', '#e8e8e8')).toBe('#0d1117')
  })
})

describe('toHexColor', () => {
  it('#rgb / #rrggbb 归一为小写六位', () => {
    expect(toHexColor('#ABC')).toBe('#aabbcc')
    expect(toHexColor(' #0D1117 ')).toBe('#0d1117')
  })
  it('不是十六进制色 → null（该字段退化为文本输入）', () => {
    expect(toHexColor('rgba(0,0,0,.5)')).toBeNull()
    expect(toHexColor('color-mix(in srgb, red 50%, blue)')).toBeNull()
    expect(toHexColor('red')).toBeNull()
  })
})

describe('toNumber', () => {
  it('按单位取数字', () => {
    expect(toNumber('1.05rem', 'rem')).toBe(1.05)
    expect(toNumber('680px', 'px')).toBe(680)
    expect(toNumber('1.9', '')).toBe(1.9)
  })
  it('单位不符或表达不了 → null', () => {
    expect(toNumber('1.05em', 'rem')).toBeNull()
    expect(toNumber('clamp(1rem, 2vw, 1.4rem)', 'rem')).toBeNull()
    expect(toNumber('680px', '')).toBeNull()
  })
})
