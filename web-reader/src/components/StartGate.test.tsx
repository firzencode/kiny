import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartGate, KINY_SITE_URL } from './StartGate'

describe('StartGate', () => {
  it('显示标题与开始按钮', () => {
    render(<StartGate title="雾港之夜" onStart={() => {}} />)
    expect(screen.getByText('雾港之夜')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始阅读' })).toBeInTheDocument()
  })
  it('底部署名链接指向 Kiny 主页', () => {
    render(<StartGate title="雾港之夜" onStart={() => {}} />)
    const link = screen.getByRole('link', { name: /Made with Kiny/i })
    expect(link).toHaveAttribute('href', KINY_SITE_URL)
  })
  it('点击开始触发回调', async () => {
    const onStart = vi.fn()
    render(<StartGate title="雾港之夜" onStart={onStart} />)
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
