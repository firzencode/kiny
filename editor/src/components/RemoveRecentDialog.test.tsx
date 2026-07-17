import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RemoveRecentDialog } from './RemoveRecentDialog'

const TARGET = { dir: 'D:\\projects\\fog-harbor', name: '雾港之夜', ts: 200 }

describe('RemoveRecentDialog', () => {
  it('target=null 时不渲染', () => {
    const { container } = render(
      <RemoveRecentDialog target={null} onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('有 target：标题 + 项目名 + 两按钮，点删除触发 onConfirm', async () => {
    const onConfirm = vi.fn(), onCancel = vi.fn()
    render(<RemoveRecentDialog target={TARGET} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('dialog', { name: '从最近项目中移除' })).toBeInTheDocument()
    expect(screen.getByText(/雾港之夜/)).toBeInTheDocument()
    expect(screen.getByText(/磁盘上的项目文件不会被删除/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('点取消触发 onCancel', async () => {
    const onCancel = vi.fn()
    render(<RemoveRecentDialog target={TARGET} onConfirm={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Esc 触发 onCancel', () => {
    const onCancel = vi.fn()
    render(<RemoveRecentDialog target={TARGET} onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('点背景遮罩触发 onCancel', async () => {
    const onCancel = vi.fn()
    const { container } = render(
      <RemoveRecentDialog target={TARGET} onConfirm={() => {}} onCancel={onCancel} />,
    )
    await userEvent.click(container.querySelector('.confirm-scrim')!)
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
