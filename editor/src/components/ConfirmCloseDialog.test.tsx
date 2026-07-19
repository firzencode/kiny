import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmCloseDialog } from './ConfirmCloseDialog'

const noop = () => {}

describe('ConfirmCloseDialog', () => {
  it('intent=null 时不渲染', () => {
    const { container } = render(
      <ConfirmCloseDialog intent={null} dirtyCount={0} aiRunning={false} onSave={noop} onDiscard={noop} onCancel={noop} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('tab 场景：标题 + 文件名 + 三按钮，点击触发对应回调', async () => {
    const onSave = vi.fn(), onDiscard = vi.fn(), onCancel = vi.fn()
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'tab', path: 'chapters/a.kin' }} dirtyCount={1} aiRunning={false}
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

  it('仅脏（exit）：标题 + 脏文件数 + 保存/不保存并退出/取消', () => {
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'exit' }} dirtyCount={3} aiRunning={false}
        onSave={noop} onDiscard={noop} onCancel={noop}
      />,
    )
    expect(screen.getByRole('dialog', { name: '退出 Kiny Editor' })).toBeInTheDocument()
    expect(screen.getByText(/有 3 个文件未保存，退出前是否保存/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不保存并退出' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('仅 AI 在跑（switchProject，不脏）：中止并切换 + 取消，无保存/丢弃', () => {
    const onDiscard = vi.fn()
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'switchProject', dir: '/p/b' }} dirtyCount={0} aiRunning={true}
        onSave={noop} onDiscard={onDiscard} onCancel={noop}
      />,
    )
    expect(screen.getByRole('dialog', { name: '切换项目' })).toBeInTheDocument()
    expect(screen.getByText(/AI 正在运行，切换将中止它/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /保存/ })).toBeNull() // 无脏 → 无保存/丢弃
    fireEvent.click(screen.getByRole('button', { name: '中止并切换' }))
    expect(onDiscard).toHaveBeenCalledOnce() // 「中止并切换」走 discard（不保存直接离开）
  })

  it('脏 + AI 在跑（closeProject）：两条件都表达，保存并关闭/丢弃并关闭/取消', () => {
    const onSave = vi.fn(), onDiscard = vi.fn()
    render(
      <ConfirmCloseDialog
        intent={{ kind: 'closeProject' }} dirtyCount={2} aiRunning={true}
        onSave={onSave} onDiscard={onDiscard} onCancel={noop}
      />,
    )
    expect(screen.getByText(/AI 正在运行，且有 2 个文件未保存。关闭将中止 AI/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存并关闭' }))
    fireEvent.click(screen.getByRole('button', { name: '丢弃并关闭' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('动作词随 intent 变（switch/close/exit）', () => {
    const { rerender } = render(
      <ConfirmCloseDialog intent={{ kind: 'switchProject', dir: '/p' }} dirtyCount={1} aiRunning={false} onSave={noop} onDiscard={noop} onCancel={noop} />,
    )
    expect(screen.getByRole('button', { name: '不保存并切换' })).toBeInTheDocument()
    rerender(<ConfirmCloseDialog intent={{ kind: 'closeProject' }} dirtyCount={1} aiRunning={false} onSave={noop} onDiscard={noop} onCancel={noop} />)
    expect(screen.getByRole('button', { name: '不保存并关闭' })).toBeInTheDocument()
  })

  it('Esc 触发 onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmCloseDialog intent={{ kind: 'exit' }} dirtyCount={1} aiRunning={false} onSave={noop} onDiscard={noop} onCancel={onCancel} />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('点背景遮罩触发 onCancel', async () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmCloseDialog intent={{ kind: 'exit' }} dirtyCount={1} aiRunning={false} onSave={noop} onDiscard={noop} onCancel={onCancel} />,
    )
    await userEvent.click(container.querySelector('.confirm-scrim')!)
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
