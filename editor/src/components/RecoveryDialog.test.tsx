import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecoveryDialog } from './RecoveryDialog'
import type { RecoverableItem } from '../state/drafts'

const items: RecoverableItem[] = [
  { path: 'main.kin', source: 'A', status: 'ok' },
  { path: 'chapters/two.kin', source: 'B', status: 'diskChanged' },
  { path: 'gone.kin', source: 'C', status: 'missing' },
]

describe('RecoveryDialog', () => {
  it('items 空 / null 不渲染', () => {
    const { container, rerender } = render(<RecoveryDialog items={null} onRecover={vi.fn()} onDiscard={vi.fn()} />)
    expect(container.firstChild).toBeNull()
    rerender(<RecoveryDialog items={[]} onRecover={vi.fn()} onDiscard={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('列出受影响文件，标注磁盘变化 / 缺失', () => {
    render(<RecoveryDialog items={items} onRecover={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '恢复未保存的改动' })).toBeInTheDocument()
    expect(screen.getByText('main.kin')).toBeInTheDocument()
    expect(screen.getByText('chapters/two.kin')).toBeInTheDocument()
    expect(screen.getByText(/磁盘文件已变化/)).toBeInTheDocument()
    expect(screen.getByText(/已删除或改名/)).toBeInTheDocument()
  })

  it('恢复 / 丢弃 触发回调', async () => {
    const onRecover = vi.fn(), onDiscard = vi.fn()
    render(<RecoveryDialog items={items} onRecover={onRecover} onDiscard={onDiscard} />)
    await userEvent.click(screen.getByRole('button', { name: '恢复' }))
    expect(onRecover).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '丢弃' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('强制二选：Esc / 点遮罩 都不触发删除（避免误删崩溃后唯一可恢复内容）', async () => {
    const onDiscard = vi.fn(), onRecover = vi.fn()
    const { container } = render(<RecoveryDialog items={items} onRecover={onRecover} onDiscard={onDiscard} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    await userEvent.click(container.querySelector('.confirm-scrim')!)
    expect(onDiscard).not.toHaveBeenCalled()
    expect(onRecover).not.toHaveBeenCalled()
  })

  it('全部 missing 时「恢复」禁用（无可载回内容）', () => {
    render(<RecoveryDialog items={[{ path: 'gone.kin', source: 'C', status: 'missing' }]} onRecover={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByRole('button', { name: '恢复' })).toBeDisabled()
  })
})
