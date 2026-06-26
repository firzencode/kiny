import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { createRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { EditorPane, type EditorHandle } from './EditorPane'
import { readClipboardText } from '../clipboard'

vi.mock('../clipboard', () => ({ readClipboardText: vi.fn() }))

/** 从渲染结果取内部 EditorView。 */
function getView(container: HTMLElement): EditorView {
  const el = container.querySelector('.cm-editor') as HTMLElement
  const view = EditorView.findFromDOM(el)
  if (!view) throw new Error('未找到 EditorView')
  return view
}

describe('EditorPane（CM6 host）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('渲染 source 文本到编辑器', () => {
    const { container } = render(<EditorPane source={'第一行\n第二行'} onChange={vi.fn()} caretLine={null} />)
    expect(getView(container).state.doc.toString()).toBe('第一行\n第二行')
  })

  it('用户编辑（非外部回灌）回调 onChange 一次，携带新文本', () => {
    const onChange = vi.fn()
    const { container } = render(<EditorPane source={''} onChange={onChange} caretLine={null} />)
    const view = getView(container)
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'x' } })
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('外部 source 回灌不回调 onChange（斩回环），且同步进 doc', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<EditorPane source={'abc'} onChange={onChange} caretLine={null} />)
    rerender(<EditorPane source={'abcd'} onChange={onChange} caretLine={null} />)
    expect(onChange).not.toHaveBeenCalled()
    expect(getView(container).state.doc.toString()).toBe('abcd')
  })

  it('同值回灌不产生事务（doc 不变、不回调）', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<EditorPane source={'abc'} onChange={onChange} caretLine={null} />)
    const before = getView(container).state
    rerender(<EditorPane source={'abc'} onChange={onChange} caretLine={null} />)
    expect(getView(container).state).toBe(before) // 未 dispatch → state 引用不变
    expect(onChange).not.toHaveBeenCalled()
  })

  it('命令句柄 selectAll 选中全文', () => {
    const ref = createRef<EditorHandle>()
    const { container } = render(<EditorPane ref={ref} source={'abc'} onChange={vi.fn()} caretLine={null} />)
    act(() => ref.current!.exec('selectAll'))
    const sel = getView(container).state.selection.main
    expect(sel.from).toBe(0)
    expect(sel.to).toBe(3)
  })

  it('命令句柄 paste 经剪贴板插件读取并插入到选区', async () => {
    vi.mocked(readClipboardText).mockResolvedValue('XYZ')
    const ref = createRef<EditorHandle>()
    function Host() {
      const [src, setSrc] = useState('abc')
      return <EditorPane ref={ref} source={src} onChange={setSrc} caretLine={null} />
    }
    const { container } = render(<Host />)
    const view = getView(container)
    act(() => { view.dispatch({ selection: EditorSelection.cursor(1) }) }) // 光标在 'a' 之后
    await act(async () => {
      ref.current!.exec('paste')
      await Promise.resolve()
    })
    expect(readClipboardText).toHaveBeenCalled()
    expect(getView(container).state.doc.toString()).toBe('aXYZbc')
  })

  it('外部 caretLine 把光标移到该行行首', () => {
    const { container, rerender } = render(
      <EditorPane source={'l1\nl2\nl3'} onChange={vi.fn()} caretLine={null} />,
    )
    rerender(<EditorPane source={'l1\nl2\nl3'} onChange={vi.fn()} caretLine={3} />)
    const view = getView(container)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from)
  })

  it('caretLine 消费后回调 onCaretConsumed（一次性，防切档重挂时旧行号拽光标）', () => {
    const onCaretConsumed = vi.fn()
    const { rerender } = render(
      <EditorPane source={'l1\nl2\nl3'} onChange={vi.fn()} caretLine={null} onCaretConsumed={onCaretConsumed} />,
    )
    expect(onCaretConsumed).not.toHaveBeenCalled() // null 不消费
    rerender(<EditorPane source={'l1\nl2\nl3'} onChange={vi.fn()} caretLine={2} onCaretConsumed={onCaretConsumed} />)
    expect(onCaretConsumed).toHaveBeenCalledTimes(1)
  })
})
