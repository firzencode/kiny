import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { EditorPane, type EditorHandle } from './EditorPane'
import { readClipboardText } from '../clipboard'

vi.mock('../clipboard', () => ({ readClipboardText: vi.fn() }))

describe('EditorPane', () => {
  it('渲染 source 文本与对应行号', () => {
    render(<EditorPane source={'第一行\n第二行\n第三行'} onChange={vi.fn()} caretLine={null} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(ta.value).toBe('第一行\n第二行\n第三行')
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('打字回调 onChange 携带新文本', async () => {
    const onChange = vi.fn()
    render(<EditorPane source={''} onChange={onChange} caretLine={null} />)
    await userEvent.type(screen.getByRole('textbox'), 'x')
    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('highlight=false 时高亮层加 plain 类（关闭语义着色）', () => {
    const { container } = render(
      <EditorPane source={'=== 开场 ==='} onChange={vi.fn()} caretLine={null} highlight={false} />,
    )
    expect(container.querySelector('.editor-highlight.plain')).toBeTruthy()
  })

  it('命令句柄 selectAll 选中 textarea 全文', () => {
    const ref = createRef<EditorHandle>()
    render(<EditorPane ref={ref} source={'abc'} onChange={vi.fn()} caretLine={null} />)
    ref.current!.exec('selectAll')
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(ta.selectionStart).toBe(0)
    expect(ta.selectionEnd).toBe(3)
  })

  describe('编辑区自定义右键菜单', () => {
    it('右键弹出菜单：剪切/复制/粘贴/全选，并阻止原生菜单', () => {
      render(<EditorPane source={'abc'} onChange={vi.fn()} caretLine={null} />)
      const ta = screen.getByRole('textbox')
      const notPrevented = fireEvent.contextMenu(ta)
      expect(notPrevented).toBe(false) // 默认行为被阻止 → 无原生菜单
      expect(screen.getByText('剪切')).toBeInTheDocument()
      expect(screen.getByText('复制')).toBeInTheDocument()
      expect(screen.getByText('粘贴')).toBeInTheDocument()
      expect(screen.getByText('全选')).toBeInTheDocument()
    })

    it('点「全选」选中全文', () => {
      render(<EditorPane source={'abc'} onChange={vi.fn()} caretLine={null} />)
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      fireEvent.contextMenu(ta)
      fireEvent.click(screen.getByText('全选'))
      expect(ta.selectionStart).toBe(0)
      expect(ta.selectionEnd).toBe(3)
    })

    it('点「复制」调用 execCommand("copy")，并关闭菜单', () => {
      document.execCommand = vi.fn().mockReturnValue(true)
      render(<EditorPane source={'abc'} onChange={vi.fn()} caretLine={null} />)
      const ta = screen.getByRole('textbox')
      fireEvent.contextMenu(ta)
      fireEvent.click(screen.getByText('复制'))
      expect(document.execCommand).toHaveBeenCalledWith('copy')
      expect(screen.queryByText('复制')).toBeNull()
    })

    it('点「粘贴」经剪贴板插件读取并插入到光标处，光标落在插入文本之后', async () => {
      vi.mocked(readClipboardText).mockResolvedValue('XYZ')
      function Host() {
        const [src, setSrc] = useState('abc')
        return <EditorPane source={src} onChange={setSrc} caretLine={null} />
      }
      render(<Host />)
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      ta.focus()
      ta.setSelectionRange(1, 1) // 光标在 'a' 之后
      fireEvent.contextMenu(ta)
      fireEvent.click(screen.getByText('粘贴'))
      await waitFor(() => expect(ta.value).toBe('aXYZbc'))
      expect(readClipboardText).toHaveBeenCalled()
      expect(ta.selectionStart).toBe(4)
      expect(ta.selectionEnd).toBe(4)
    })
  })
})
