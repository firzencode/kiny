import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from './SettingsDialog'
import { DEFAULT_SETTINGS } from '../state/settings'

const base = {
  open: true, settings: DEFAULT_SETTINGS, theme: 'dark' as const,
  onSave: vi.fn(), onCancel: vi.fn(),
}

beforeEach(() => { document.documentElement.removeAttribute('style') })

describe('SettingsDialog', () => {
  it('open=false 不渲染', () => {
    const { container } = render(<SettingsDialog {...base} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('渲染弹窗与三键，保存初始禁用', () => {
    render(<SettingsDialog {...base} />)
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复默认' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('改代码字号 → 仅动草稿（保存启用、documentElement 不变）', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('')
  })

  it('保存 → onSave 带更新后的设置与主题', async () => {
    const onSave = vi.fn()
    render(<SettingsDialog {...base} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, codeSize: 14 }, 'dark')
  })

  it('步进器在上限夹紧（无变化、保存仍禁用）', async () => {
    render(<SettingsDialog {...base} settings={{ ...DEFAULT_SETTINGS, codeLh: 2.2 }} />)
    await userEvent.click(screen.getByRole('button', { name: '增大代码行距' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('取消 / Esc / ✕ / 遮罩 → onCancel，从不 onSave', async () => {
    const onCancel = vi.fn(), onSave = vi.fn()
    const { container } = render(<SettingsDialog {...base} onCancel={onCancel} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    await userEvent.click(container.querySelector('.settings-scrim')!)
    expect(onCancel).toHaveBeenCalledTimes(4)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('恢复默认 → 草稿回默认（从非默认初值，保存随之启用）', async () => {
    render(<SettingsDialog {...base} settings={{ ...DEFAULT_SETTINGS, codeSize: 18 }} />)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('切主题 → 草稿主题变（保存启用）', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.click(screen.getByRole('button', { name: '象牙稿' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('自定义字体：选「自定义...」展开输入框', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '代码字体' }), '自定义...')
    expect(screen.getByPlaceholderText(/字体名/)).toBeInTheDocument()
  })
})
