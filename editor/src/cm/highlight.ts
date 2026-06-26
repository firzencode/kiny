/**
 * Kin 语义着色的 CM6 桥：把 `tokenizeLine` 的 token 类（`t-node` / `t-divert` …）
 * 接到 CodeMirror 的 highlight 体系上。
 *
 * 取向：复用编辑器现有 CSS 类（`.t-node` 等，色值挂 `--s-*` 变量、双主题已就绪），
 * 不在 CM 里重定义颜色——每个 Kin token 类定义一个 lezer `Tag`，`HighlightStyle`
 * 把 Tag 映射成同名 CSS 类，沿用 styles.css 既有规则。
 */
import { Tag } from '@lezer/highlight'
import { HighlightStyle } from '@codemirror/language'

/** 每个 Kin token 类一个自定义 Tag（`tokenTable` 用）。`t-text` 是默认正文、无 Tag。 */
export const kinTags: Record<string, Tag> = {
  't-comment': Tag.define(),
  't-node': Tag.define(),
  't-node-d': Tag.define(),
  't-command': Tag.define(),
  't-logic': Tag.define(),
  't-divert': Tag.define(),
  't-interp': Tag.define(),
  't-string': Tag.define(),
  't-keyword': Tag.define(),
  't-marker': Tag.define(),
  't-bracket': Tag.define(),
  't-num': Tag.define(),
  't-tag': Tag.define(),
  'depth-guide': Tag.define(),
}

/**
 * StreamParser.token 返回的 token 名 → Tag 的查表（`tokenTable`）。
 * 直接用 `tokenizeLine` 的 cls 串当 token 名，键名一致、零额外映射。
 */
export const kinTokenTable: Record<string, Tag> = kinTags

/**
 * `tokenizeLine` 的 cls → CM token 名。`t-text` 返回 null（默认正文，不着色）。
 * 其余原样返回 cls，由 `kinTokenTable` 解析为 Tag。
 */
export function clsToToken(cls: string): string | null {
  if (cls === 't-text') return null
  return kinTags[cls] ? cls : null
}

/** Tag → 同名 CSS 类。沿用 styles.css 既有 `.t-*` / `.depth-guide` 规则（色值走 `--s-*`）。 */
export const kinHighlightStyle = HighlightStyle.define(
  Object.entries(kinTags).map(([cls, tag]) => ({ tag, class: cls })),
)
