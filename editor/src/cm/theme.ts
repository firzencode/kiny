/**
 * CM6 主题：直接消费编辑器现有 CSS 变量（`--code-*` 字体字号、`--s-text` 正文色、
 * `--bg-*` / `--text-*` / `--accent` / `--border`）。双主题切换、设置弹窗、view 菜单 zoom
 * 改的都是这些变量，故 CM 主题零改动随之生效。
 */
import { EditorView } from '@codemirror/view'

/**
 * 选中背景选择器（聚焦态 CM 绘制层 + 未聚焦 + 原生 ::selection 回退）。
 *
 * ⚠ 特指度必须压过 `drawSelection()` 的 baseTheme：后者对聚焦态选中层用
 * `&{light|dark}.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
 * ——**5 个 class** 的高特指度规则（@codemirror/view）。若这里只写
 * `&.cm-focused .cm-selectionBackground`（前缀展开后仅 3 个 class），CSS 特指度上
 * 反被 baseTheme 盖过，聚焦选文字时根本不走 `--sel-bg`，而是显 CM 默认灰/浅紫
 * ——且 kinTheme 未声明 `{dark:true}`，CM 始终按 `&light` 取默认色，暗色下尤其明显
 * “选中色没生效”。故聚焦分支补齐到同样 5 个 class（`.cm-scroller .cm-selectionLayer`）：
 * 特指度持平后，theme 比 baseTheme 后挂载（后者 `Prec.lowest`），同分靠挂载序取胜。
 * 未聚焦分支 `.cm-selectionLayer .cm-selectionBackground`（3 class）亦压过 baseTheme 的
 * 未聚焦 2-class 规则。
 */
export const SELECTION_SELECTOR =
  '&.cm-focused .cm-scroller .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection'

/**
 * 主题样式规格（`EditorView.theme` 的入参）。抽成具名对象供 theme.test.ts 断言
 * 关键不变量（如选中背景不得再用 accent 着色）。
 */
export const kinThemeSpec = {
  '&': {
    height: '100%',
    color: 'var(--s-text)',
    backgroundColor: 'var(--bg-0)',
    fontSize: 'var(--code-size)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--code-font)',
    lineHeight: 'var(--code-lh)',
    // 关编程连字：=== / -> / => 等不连写成一个字形（与原编辑区一致）。
    fontVariantLigatures: 'none',
    fontFeatureSettings: "'liga' 0, 'calt' 0",
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '14px 0 40vh 0',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-0)',
    color: 'var(--text-faint)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 16px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-2)',
    boxShadow: 'inset 2px 0 0 var(--accent-line)',
  },
  // 选中背景走中性不透明的 `--sel-bg`（非 accent 着色）：金色系语法 token（node/interp
  // 同取 --accent）在 accent 色相的选中层上会撞色、文字看不清；中性 slate 与所有色相 token
  // 都拉开对比，且不透明使对比度恒定、不因选中落在活动行(bg-2)而退化。
  [SELECTION_SELECTOR]: {
    backgroundColor: 'var(--sel-bg)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
  '.cm-matchingBracket': {
    outline: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
    backgroundColor: 'transparent',
  },
  // 折叠把手 / 折叠占位
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-faint)', cursor: 'pointer' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-dim)',
    margin: '0 4px',
    padding: '0 6px',
    borderRadius: '4px',
  },
  // 补全弹窗 / 诊断 tooltip
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-1)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: '6px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--bg-2)',
    color: 'var(--text)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { fontFamily: 'var(--code-font)' },
  '.cm-completionIcon': { color: 'var(--text-dim)' },
  '.cm-panels': { backgroundColor: 'var(--bg-1)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--s-node) 30%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  },
} as const

export const kinTheme = EditorView.theme(kinThemeSpec)
