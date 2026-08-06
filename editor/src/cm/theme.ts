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
 * 活动行底色垫层的 z-index。
 *
 * 必须比 CM 选中层更负：`drawSelection()` 的 `.cm-selectionLayer` 是 `.cm-scroller`
 * （`position:relative; z-index:0`，层叠上下文根）里 z-index 为负的绝对定位层
 * （`(above ? 150 : -1) - pos`，当前实测 -2）。取 -5 留出余量，将来即便再挂几个
 * below 层（z 依次更负）也不至于反超。
 */
export const ACTIVE_LINE_Z = -5

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
  // 活动行底色画在 ::before 垫层上、而非行元素自身的 background。
  //
  // 按 CSS 绘制顺序，同一层叠上下文内「负 z-index 的定位后代」先于「常规流块级元素的
  // 背景」绘制：行元素自身若着不透明底色，这块底色就整片盖住其下的 `.cm-selectionLayer`
  // ——当前行拖选文字将完全看不到选中高亮（非活动行无底色，故只在当前行复现）。
  //
  // 垫层绝对定位铺满行盒，z-index 取比选中层更负的 ACTIVE_LINE_Z，于是三层稳定叠成
  // 「行底色 < 选中矩形 < 行内文字」。行元素设 position:relative 只为给垫层当定位参照，
  // z-index 保持 auto——不建立层叠上下文，垫层的负 z-index 才能逃逸到 `.cm-scroller`
  // 上下文里与选中层直接比较。左侧 accent 竖条走 inset box-shadow，属行元素自身的背景
  // 绘制阶段，仍压在选中层之上、始终可见。
  '.cm-activeLine': {
    position: 'relative',
    backgroundColor: 'transparent',
    boxShadow: 'inset 2px 0 0 var(--accent-line)',
  },
  '.cm-activeLine::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    zIndex: String(ACTIVE_LINE_Z),
    backgroundColor: 'var(--bg-2)',
    pointerEvents: 'none',
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
