import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmCloseDialog } from './ConfirmCloseDialog'

describe('ConfirmCloseDialog', () => {
  it('intent=null 时不渲染', () => {
    const { container } = render(
      <ConfirmCloseDialog intent={null} dirtyCount={0} onSave={() => {}} onDiscard={() => {}} onCancel={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('tab 场景：标题 + 文件名 + 三按钮，点击触发对应回调', async () => {
    const onSave = vi.fn(), onDiscard = vi.fn(), onCancel = vi.fn()
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'tab', path: 'chapters/a.kin' }} dirtyCount={1}
        onSave={onSave} onDiscard={onDiscard} onCancel={onCancel}
      />,
    )
    expect(screen.getByRole('dialog', { name: '关闭未保存的文件' })).toBeInTheDocument()
    expect(screen.getByText(/chapters\/a\.kin/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await userEvent.click(screen.getByRole('button', { name: '不保存' }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('exit 场景：标题 + 脏文件数 + 三按钮', () => {
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'exit' }} dirtyCount={3}
        onSave={() => {}} onDiscard={() => {}} onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('dialog', { name: '退出 Kiny Editor' })).toBeInTheDocument()
    expect(screen.getByText(/有 3 个文件未保存/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不保存并退出' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('Esc 触发 onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'exit' }} dirtyCount={1}
        onSave={() => {}} onDiscard={() => {}} onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('点背景遮罩触发 onCancel', async () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmCloseDialog
        intent={{ kind: 'exit' }} dirtyCount={1}
        onSave={() => {}} onDiscard={() => {}} onCancel={onCancel}
      />,
    )
    await userEvent.click(container.querySelector('.confirm-scrim')!)
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
