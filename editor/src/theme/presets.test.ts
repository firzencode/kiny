import { describe, it, expect } from 'vitest'
import { THEME_PRESETS, PRESET_TOKENS, applyPreset } from './presets'
import { scanThemeCss } from './scan'
import { toHexColor, toNumber, THEME_FIELDS, GENERIC_FONTS } from './fields'
import { parseColor } from './color'

/** 便捷：扫出来的 token → { 名: 值 } */
function tokens(css: string): Record<string, string> {
  const r = scanThemeCss(css)
  if (!r.ok) throw new Error(`扫描失败: ${r.reason}`)
  return Object.fromEntries(r.tokens.map((t) => [t.name, t.value]))
}

/**
 * WCAG 相对亮度 → 对比度。半透明色（`rgba(…)`）先按给定底色合成再算——控件底色本就是
 * 叠在页面底色上的，不合成就量不出真实观感。
 */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** `#rgb` / `#rrggbb` / `rgba(r,g,b,a)` → 与底色合成后的 `#rrggbb`。 */
function flatten(value: string, onHex: string): string {
  const direct = toHexColor(value)
  if (direct) return direct
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value.trim())
  if (!m) throw new Error(`认不出的颜色: ${value}`)
  const a = m[4] === undefined ? 1 : Number(m[4])
  const under = [1, 3, 5].map((i) => parseInt(onHex.slice(i, i + 2), 16))
  const mixed = [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + under[i - 1] * (1 - a)))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function contrast(fg: string, bgValue: string): number {
  const bg = toHexColor(bgValue)!
  const a = luminance(flatten(fg, bg))
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

describe('THEME_PRESETS 的形状', () => {
  it('3–5 套，各有名字且不重名', () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(3)
    expect(THEME_PRESETS.length).toBeLessThanOrEqual(5)
    const names = THEME_PRESETS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每套都设**同一组** token：否则从 A 换到 B 会留下 A 的残值，配色关系错乱', () => {
    for (const p of THEME_PRESETS) {
      expect(Object.keys(p.tokens).sort(), `预置「${p.name}」的 token 集不齐`).toEqual([...PRESET_TOKENS].sort())
    }
  })

  it('底色与文字色都是十六进制（GUI 取色器要认得，不然套完就退化成文本框）', () => {
    for (const p of THEME_PRESETS) {
      expect(toHexColor(p.tokens['--kiny-page-bg']), p.name).not.toBeNull()
      expect(toHexColor(p.tokens['--kiny-text']), p.name).not.toBeNull()
    }
  })

  it('按钮文字在各套底色上都读得清：播放层默认是白字白边，落在浅底上根本看不见', () => {
    for (const p of THEME_PRESETS) {
      const ratio = contrast(p.tokens['--kiny-control-text'], p.tokens['--kiny-page-bg'])
      expect(ratio, `${p.name} 的按钮文字对比度 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('按钮描边在各套底色上都看得见：选项是读者唯一能点的东西，边框就是它的全部轮廓', () => {
    for (const p of THEME_PRESETS) {
      // WCAG 1.4.11：非文本的 UI 部件边界要 3:1
      const ratio = contrast(p.tokens['--kiny-control-border'], p.tokens['--kiny-page-bg'])
      expect(ratio, `${p.name} 的按钮描边对比度 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('正文与错误提示在各套底色上都读得清', () => {
    for (const p of THEME_PRESETS) {
      expect(contrast(p.tokens['--kiny-text'], p.tokens['--kiny-page-bg']), `${p.name} 正文`).toBeGreaterThanOrEqual(7)
      expect(contrast(p.tokens['--kiny-error'], p.tokens['--kiny-page-bg']), `${p.name} 错误色`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('每套的值都落在 GUI 控件表达得了的形态里（否则套完控件就退化成文本框）', () => {
    for (const p of THEME_PRESETS) {
      for (const f of THEME_FIELDS) {
        const v = p.tokens[f.name]
        if (v === undefined) continue // 不在预置集里的 token（面板类）由 GUI 显示推导默认值
        if (f.kind === 'color') {
          // 带透明度的字段用 parseColor（rgba 也算表达得了），不带的仍须是纯色
          expect(f.alpha ? parseColor(v) : toHexColor(v), `${p.name} 的 ${f.label}`).not.toBeNull()
        } else if (f.kind === 'font') {
          expect(GENERIC_FONTS.map((g) => g.value), `${p.name} 的 ${f.label}`).toContain(v)
        } else {
          const n = toNumber(v, f.spec.unit)
          expect(n, `${p.name} 的 ${f.label}`).not.toBeNull()
          expect(n!, `${p.name} 的 ${f.label} 超出滑杆量程`).toBeGreaterThanOrEqual(f.spec.min)
          expect(n!).toBeLessThanOrEqual(f.spec.max)
        }
      }
    }
  })
})

describe('applyPreset', () => {
  const authored = `/* 我的主题 —— 别动我的注释 */

.player {
  --kiny-page-bg: #0d1117;   /* 页面底色 */
  --kiny-text: #e8e8e8;
}

/* 自定义：底栏压暗 */
.player .panel-bottom { background: rgba(0, 0, 0, .3); }
`
  const preset = THEME_PRESETS[1]

  it('批量改写：涉及的 token 都变成该套的值', () => {
    const next = applyPreset(authored, preset)
    const t = tokens(next)
    for (const [name, value] of Object.entries(preset.tokens)) expect(t[name], name).toBe(value)
  })

  it('作者的注释与自定义样式逐字保留（不覆盖整个文件，故无需备份）', () => {
    const next = applyPreset(authored, preset)
    expect(next).toContain('/* 我的主题 —— 别动我的注释 */')
    expect(next).toContain('/* 页面底色 */')
    expect(next).toContain('/* 自定义：底栏压暗 */')
    expect(next).toContain('.player .panel-bottom { background: rgba(0, 0, 0, .3); }')
  })

  it('文件里缺的 token 被**追加**进 .player 块，而非整块重写', () => {
    const before = scanThemeCss(authored)
    const after = scanThemeCss(applyPreset(authored, preset))
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok) return
    // 原有两条声明仍在原位（顺序未被打乱），只是值变了
    expect(after.tokens.slice(0, 2).map((t) => t.name)).toEqual(['--kiny-page-bg', '--kiny-text'])
    expect(after.tokens.length).toBe(PRESET_TOKENS.length)
  })

  it('连套两套 → 第二套完全生效，不留第一套的残值', () => {
    const once = applyPreset(authored, THEME_PRESETS[1])
    const twice = applyPreset(once, THEME_PRESETS[2])
    const t = tokens(twice)
    for (const [name, value] of Object.entries(THEME_PRESETS[2].tokens)) expect(t[name], name).toBe(value)
  })

  it('反复套同一套是幂等的（文本不再变化）', () => {
    const once = applyPreset(authored, preset)
    expect(applyPreset(once, preset)).toBe(once)
  })

  it('末条声明省分号的手写文件 → 套用后全套 token 齐全，作者注释一个字不动', () => {
    const handWritten = '/* 我的主题 */\n.player {\n  --kiny-page-bg: #000;\n  --kiny-error: #f00 /* 别删我 */\n}\n'
    const next = applyPreset(handWritten, preset)
    expect(next).toContain('/* 别删我 */')
    expect(next).toContain('/* 我的主题 */')
    const t = tokens(next)
    for (const name of PRESET_TOKENS) expect(t[name], `${name} 丢了`).toBe(preset.tokens[name])
  })

  it('解析不了的文件 → 原样返回，绝不整块重写作者的文件', () => {
    const broken = '.player {\n  --kiny-text: #111;\n'
    expect(applyPreset(broken, preset)).toBe(broken)
  })

  it('空文件 → 补出一个 .player 块，套装齐全', () => {
    const next = applyPreset('', preset)
    expect(Object.keys(tokens(next)).sort()).toEqual([...PRESET_TOKENS].sort())
  })
})
