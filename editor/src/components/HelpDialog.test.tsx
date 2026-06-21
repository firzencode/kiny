import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpDialog } from './HelpDialog'

describe('HelpDialog', () => {
  it('screen=null 时不渲染任何浮层', () => {
    const { container } = render(<HelpDialog screen={null} onClose={vi.fn()} />)
    expect(container.querySelector('.help-scrim')).toBeNull()
  })

  it('关于屏：字标、副标题、版本四格', () => {
    render(<HelpDialog screen="about" onClose={vi.fn()} />)
    expect(screen.getByText('互动叙事编辑器')).toBeInTheDocument()
    expect(screen.getByText('播放层')).toBeInTheDocument()
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument()
    expect(screen.getByText(/firzencode/)).toBeInTheDocument()
  })

  it('语法参考屏：标题与分节内容', () => {
    render(<HelpDialog screen="syntax" onClose={vi.fn()} />)
    expect(screen.getByText('语法参考')).toBeInTheDocument()
    // 小节标题在导航与内容里各出现一次，故用 getAllByText
    expect(screen.getAllByText('节点').length).toBeGreaterThan(0)
    expect(screen.getAllByText('带参节点').length).toBeGreaterThan(0)
    expect(screen.getAllByText('文本变体').length).toBeGreaterThan(0)
    expect(screen.getAllByText('内置命令').length).toBeGreaterThan(0)
  })

  it('Esc 关闭', async () => {
    const onClose = vi.fn()
    render(<HelpDialog screen="about" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('点遮罩关闭；点对话框内部不关闭', async () => {
    const onClose = vi.fn()
    const { container } = render(<HelpDialog screen="about" onClose={onClose} />)
    await userEvent.click(container.querySelector('.help-dlg')!)
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(container.querySelector('.help-scrim')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关于屏：标注内嵌字体 JetBrains Mono 的 OFL 许可', () => {
    render(<HelpDialog screen="about" onClose={vi.fn()} />)
    expect(screen.getByText(/JetBrains Mono/)).toBeInTheDocument()
    expect(screen.getByText(/OFL/)).toBeInTheDocument()
  })
})
