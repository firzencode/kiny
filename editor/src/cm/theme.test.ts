import { describe, it, expect } from 'vitest'
import { kinThemeSpec, SELECTION_SELECTOR } from './theme'

/**
 * T041：编辑器选中文本高亮对比度。
 * 选中背景曾用 `color-mix(accent …)` 着色，与金色系语法 token（node/interp，同取
 * `--accent`）撞色、选中态文字看不清。回归守卫：选中背景必须走中性 `--sel-bg` 变量、
 * 不得再引用 accent，确保任意色相 token 被选中都清晰可读（实际色值+观感由人工冒烟）。
 */
describe('kinTheme 选中背景', () => {
  const selRule = kinThemeSpec[SELECTION_SELECTOR] as { backgroundColor: string }

  it('选中背景走中性 --sel-bg 变量', () => {
    expect(selRule.backgroundColor).toBe('var(--sel-bg)')
  })

  it('选中背景不再用 accent 着色（去撞色根因）', () => {
    expect(selRule.backgroundColor).not.toContain('--accent')
  })

  // 特指度回归守卫：聚焦态分支必须深入 drawSelection 的绘制层（.cm-scroller /
  // .cm-selectionLayer），前缀展开后凑够 5 个 class 才能压过 baseTheme 同结构的高特指度
  // 规则；否则 `--sel-bg` 会被 CM 默认选中色盖掉（暗色下表现为“选中色没生效”）。
  it('聚焦态选择器深入绘制层、特指度足以压过 drawSelection baseTheme', () => {
    const focused = SELECTION_SELECTOR.split(',')
      .map((s) => s.trim())
      .find((s) => s.includes('.cm-focused'))
    expect(focused).toBeDefined()
    expect(focused).toContain('.cm-scroller')
    expect(focused).toContain('.cm-selectionLayer')
    expect(focused).toContain('.cm-selectionBackground')
  })
})
