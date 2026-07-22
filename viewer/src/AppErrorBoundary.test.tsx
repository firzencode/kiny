import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppErrorBoundary } from './AppErrorBoundary'

function Bomb(): never {
  throw new Error('引擎内部炸了')
}

describe('AppErrorBoundary', () => {
  it('子树抛错 → 呈现兜底信息（含错误消息），不白屏', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {}) // React 会把边界错误打到 console
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    )
    expect(screen.getByText(/出错/)).toBeInTheDocument()
    expect(screen.getByText(/引擎内部炸了/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('无错时透明渲染子树', () => {
    render(
      <AppErrorBoundary>
        <p>正文内容</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('正文内容')).toBeInTheDocument()
  })
})
