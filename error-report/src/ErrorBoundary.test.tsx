import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(() => Promise.resolve()) }))
vi.mock('./platform', () => ({
  copyText: vi.fn(() => Promise.resolve()),
  openExternalUrl: vi.fn(() => Promise.resolve()),
  openLogDir: vi.fn(() => Promise.resolve()),
}))

import { ErrorBoundary } from './ErrorBoundary'
import { getErrorEntries, clearErrorEntries } from './errorLog'

function Boom(): never {
  throw new Error('渲染炸了')
}

beforeEach(() => clearErrorEntries())

describe('ErrorBoundary', () => {
  it('子树抛错 → 渲染内置 fallback 并记 react-boundary 日志', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('应用遇到错误')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
    const e = getErrorEntries().at(-1)!
    expect(e.source).toBe('react-boundary')
    expect(e.message).toBe('渲染炸了')
    spy.mockRestore()
  })

  it('自定义 fallback 优先', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary fallback={(err) => <div>自定义：{err.message}</div>}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('自定义：渲染炸了')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('无错误时正常渲染子树', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })
})
