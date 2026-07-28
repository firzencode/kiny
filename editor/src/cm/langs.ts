import { Compartment, type Extension } from '@codemirror/state'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { kinLanguage } from './kinLanguage'

/** 语言 compartment：切文件（换扩展名）时热切换语言，不重建 EditorView。 */
export const languageCompartment = new Compartment()

/**
 * 按文件扩展名选语言支持。`.kin` 走自家 Kin 语言；作品前端资源（css / js / json / html / md）
 * 走对应 CM6 语言包；纯文本（.txt）与未知扩展名无语言（纯文本编辑，无高亮）。
 */
export function languageFor(path: string | null | undefined): Extension {
  const base = (path ?? '').slice((path ?? '').lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  switch (dot === -1 ? '' : base.slice(dot + 1)) {
    case 'kin': return kinLanguage
    case 'css': return css()
    case 'js': return javascript()
    case 'json': return json()
    case 'html': return html()
    case 'md': return markdown()
    default: return []
  }
}
