import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { toggleComment } from '@codemirror/commands'
import { kinLanguage, kinStreamParser } from './kinLanguage'

describe('Kin 行注释（toggleComment）', () => {
  it('kinLanguage 声明了行注释符 //', () => {
    expect(kinStreamParser.languageData?.commentTokens).toEqual({ line: '//' })
  })

  it('toggleComment 对 Kin 行加 // 注释、再切换取消', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: '正文一行', extensions: [kinLanguage] }),
    })
    try {
      toggleComment(view)
      expect(view.state.doc.toString()).toBe('// 正文一行')
      toggleComment(view)
      expect(view.state.doc.toString()).toBe('正文一行')
    } finally {
      view.destroy()
    }
  })
})
