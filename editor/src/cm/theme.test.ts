import { describe, it, expect } from 'vitest'
import { ACTIVE_LINE_Z, kinThemeSpec, SELECTION_SELECTOR } from './theme'

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

/**
 * 活动行底色不得盖住选中层。
 *
 * CM6 把选中矩形画在 `.cm-selectionLayer` —— `.cm-scroller`（层叠上下文根）里 z-index
 * 为负（实测 -2）的绝对定位层。按 CSS 绘制顺序，负 z-index 定位后代先画、常规流块级
 * 元素的背景后画，故 `.cm-activeLine { background }` 这种不透明行底色会整片盖掉其下的
 * 选中矩形——当前行拖选文字完全看不到高亮（非活动行无底色，故只在当前行复现）。
 * 回归守卫：行底色只能由 `::before` 画，且 z-index 必须比选中层更负。
 */
describe('kinTheme 活动行底色', () => {
  const lineRule = kinThemeSpec['.cm-activeLine'] as Record<string, string>
  const underlayRule = kinThemeSpec['.cm-activeLine::before'] as Record<string, string>

  it('行元素自身不着不透明底色（否则盖住选中层）', () => {
    expect(lineRule.backgroundColor ?? 'transparent').toBe('transparent')
  })

  it('底色由 ::before 垫层画，且铺满行盒', () => {
    expect(underlayRule).toBeDefined()
    expect(underlayRule.backgroundColor).toBe('var(--bg-2)')
    expect(underlayRule.position).toBe('absolute')
    expect(underlayRule.inset).toBe('0')
    // 垫层要相对行盒定位，行本身须是定位元素（z-index 仍为 auto，故不建层叠上下文，
    // 垫层的负 z-index 得以在 .cm-scroller 上下文里与选中层比较）。
    expect(lineRule.position).toBe('relative')
    expect(lineRule.zIndex).toBeUndefined()
  })

  it('垫层 z-index 比 CM 选中层（-2）更负', () => {
    expect(ACTIVE_LINE_Z).toBeLessThan(-2)
    expect(underlayRule.zIndex).toBe(String(ACTIVE_LINE_Z))
  })
})
