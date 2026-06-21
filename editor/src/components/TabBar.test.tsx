import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'

describe('TabBar', () => {
  const base = {
    openTabs: ['main.kin', '盘问.kin'],
    activeFile: 'main.kin',
    dirtyMap: { 'main.kin': true, '盘问.kin': false },
  }

  it('渲染各 tab，活动 tab 带 active 类，dirty 文件带未保存点', () => {
    render(<TabBar {...base} onSelect={vi.fn()} onClose={vi.fn()} />)
    const main = screen.getByText('main.kin').closest('.tab')!
    expect(main).toHaveClass('active')
    expect(main.querySelector('.tab-dirty')).toBeTruthy()
    expect(screen.getByText('盘问.kin').closest('.tab')!.querySelector('.tab-dirty')).toBeNull()
  })

  it('点 tab → onSelect(name)', async () => {
    const onSelect = vi.fn()
    render(<TabBar {...base} onSelect={onSelect} onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('盘问.kin'))
    expect(onSelect).toHaveBeenCalledWith('盘问.kin')
  })

  it('点关闭 ✕ → onClose(name)，不触发 onSelect', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TabBar {...base} onSelect={onSelect} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭 盘问.kin' }))
    expect(onClose).toHaveBeenCalledWith('盘问.kin')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
