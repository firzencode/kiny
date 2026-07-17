import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(() => Promise.resolve()) }))
const { copyText, openExternalUrl, openLogDir, readRecentLog } = vi.hoisted(() => ({
  copyText: vi.fn((_text: string) => Promise.resolve()),
  openExternalUrl: vi.fn((_url: string) => Promise.resolve()),
  openLogDir: vi.fn(() => Promise.resolve()),
  readRecentLog: vi.fn(() => Promise.resolve<string | null>('近期日志尾部内容…')),
}))
vi.mock('./platform', () => ({ copyText, openExternalUrl, openLogDir, readRecentLog }))

import { ErrorDetailsDialog } from './ErrorDetailsDialog'
import { logErrorEntry, clearErrorEntries } from './errorLog'

beforeEach(() => {
  clearErrorEntries()
  copyText.mockClear()
  openExternalUrl.mockClear()
  openLogDir.mockClear()
  logErrorEntry({ source: 'operation:importKip', message: '导入失败', stack: 'at parse' })
})

describe('ErrorDetailsDialog', () => {
  it('open=false 不渲染', () => {
    const { container } = render(<ErrorDetailsDialog open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('渲染错误条目（message + stack + 来源）', () => {
    render(<ErrorDetailsDialog open onClose={() => {}} />)
    expect(screen.getByText('导入失败')).toBeInTheDocument()
    expect(screen.getByText(/operation:importKip/)).toBeInTheDocument()
    expect(screen.getByText(/at parse/)).toBeInTheDocument()
  })

  it('复制详情调用剪贴板，且附上近期日志', async () => {
    render(<ErrorDetailsDialog open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '复制详情' }))
    expect(copyText).toHaveBeenCalledTimes(1)
    expect(readRecentLog).toHaveBeenCalled()
    const text = copyText.mock.calls[0]![0]
    expect(text).toContain('导入失败')
    expect(text).toContain('近期日志')
    expect(text).toContain('近期日志尾部内容…')
  })

  it('提交到 GitHub / 反馈问卷 / 打开日志文件夹 各调对应能力', async () => {
    render(<ErrorDetailsDialog open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '提交到 GitHub' }))
    await userEvent.click(screen.getByRole('button', { name: '填写反馈问卷' }))
    expect(openExternalUrl).toHaveBeenCalledTimes(2)
    expect(openExternalUrl.mock.calls[0]![0]).toContain('github.com/firzencode/kiny/issues/new')
    expect(openExternalUrl.mock.calls[1]![0]).toContain('docs.qq.com')
    await userEvent.click(screen.getByRole('button', { name: '打开日志文件夹' }))
    expect(openLogDir).toHaveBeenCalledTimes(1)
  })

  it('点遮罩 / 关闭按钮触发 onClose', async () => {
    const onClose = vi.fn()
    render(<ErrorDetailsDialog open onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('明示隐私提醒', () => {
    render(<ErrorDetailsDialog open onClose={() => {}} />)
    expect(screen.getByText(/日志可能含你的故事文本/)).toBeInTheDocument()
  })
})
