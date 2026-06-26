/**
 * CM6 主题：直接消费编辑器现有 CSS 变量（`--code-*` 字体字号、`--s-text` 正文色、
 * `--bg-*` / `--text-*` / `--accent` / `--border`）。双主题切换、设置弹窗、view 菜单 zoom
 * 改的都是这些变量，故 CM 主题零改动随之生效。
 */
import { EditorView } from '@codemirror/view'

export const kinTheme = EditorView.theme({
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
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
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
})
