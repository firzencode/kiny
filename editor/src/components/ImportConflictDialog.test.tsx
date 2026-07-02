import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportConflictDialog } from './ImportConflictDialog'

describe('ImportConflictDialog', () => {
  it('destRel=null 不渲染', () => {
    render(<ImportConflictDialog destRel={null} onChoose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('显示冲突路径与三选按钮', () => {
    render(<ImportConflictDialog destRel="assets/a.png" onChoose={vi.fn()} />)
    expect(screen.getByText(/assets\/a\.png/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '覆盖' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '改名' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '跳过' })).toBeInTheDocument()
  })

  it('点覆盖 → onChoose("overwrite", false)', async () => {
    const onChoose = vi.fn()
    render(<ImportConflictDialog destRel="a.png" onChoose={onChoose} />)
    await userEvent.click(screen.getByRole('button', { name: '覆盖' }))
    expect(onChoose).toHaveBeenCalledWith('overwrite', false)
  })

  it('勾选「应用到其余」后点改名 → onChoose("rename", true)', async () => {
    const onChoose = vi.fn()
    render(<ImportConflictDialog destRel="a.png" onChoose={onChoose} />)
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: '改名' }))
    expect(onChoose).toHaveBeenCalledWith('rename', true)
  })

  it('点背景 → 跳过', async () => {
    const onChoose = vi.fn()
    render(<ImportConflictDialog destRel="a.png" onChoose={onChoose} />)
    await userEvent.click(document.querySelector('.confirm-scrim')!)
    expect(onChoose).toHaveBeenCalledWith('skip', false)
  })
})
