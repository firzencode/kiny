import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { MenuBar } from './MenuBar'

function setup(over: Partial<ComponentProps<typeof MenuBar>> = {}) {
  const props = {
    projectName: '雾港之夜',
    anyDirty: true,
    errorCount: 0,
    warnCount: 0,
    hasProgram: true,
    canSave: true,
    theme: 'dark' as const,
    view: { sidebar: true, preview: true, highlight: true, ai: false },
    onNewProject: vi.fn(),
    onOpenProject: vi.fn(),
    onNewFile: vi.fn(),
    onSave: vi.fn(),
    onSaveAll: vi.fn(),
    onExit: vi.fn(),
    onEdit: vi.fn(),
    onSetTheme: vi.fn(),
    onToggleView: vi.fn(),
    onSyntaxRef: vi.fn(),
    onAbout: vi.fn(),
    onReportIssue: vi.fn(),
    onOpenSettings: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onExportKip: vi.fn(),
    onExportWebpage: vi.fn(),
    ...over,
  }
  render(<MenuBar {...props} />)
  return props
}
const openMenu = (label: string) => userEvent.click(screen.getByRole('menuitem', { name: label }))

describe('MenuBar', () => {
  it('显示项目名与未保存指示', () => {
    setup()
    expect(screen.getByText('雾港之夜')).toBeInTheDocument()
    expect(screen.getByText('● 未保存')).toBeInTheDocument()
  })

  it('文件菜单：打开/新建项目/新建文件/保存 回调', async () => {
    const p = setup()
    await openMenu('文件')
    await userEvent.click(await screen.findByRole('menuitem', { name: '打开项目...' }))
    expect(p.onOpenProject).toHaveBeenCalled()
    await openMenu('文件')
    await userEvent.click(await screen.findByRole('menuitem', { name: '新建文件...' }))
    expect(p.onNewFile).toHaveBeenCalled()
  })

  it('保存项在 canSave=false 时禁用（点击不回调）', async () => {
    const p = setup({ canSave: false })
    await openMenu('文件')
    const save = await screen.findByRole('menuitem', { name: /^保存$/ })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(save)
    expect(p.onSave).not.toHaveBeenCalled()
  })

  it('视图菜单：切主题、切开关', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '主题：象牙稿' }))
    expect(p.onSetTheme).toHaveBeenCalledWith('light')
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '节点导航 / 资源管理器' }))
    expect(p.onToggleView).toHaveBeenCalledWith('sidebar')
  })

  it('帮助菜单：关于 → onAbout', async () => {
    const p = setup()
    await openMenu('帮助')
    await userEvent.click(await screen.findByRole('menuitem', { name: '关于 Kiny Editor' }))
    expect(p.onAbout).toHaveBeenCalled()
  })

  it('帮助菜单：Kiny 语法参考 → onSyntaxRef', async () => {
    const p = setup()
    await openMenu('帮助')
    await userEvent.click(await screen.findByRole('menuitem', { name: /Kiny 语法参考/ }))
    expect(p.onSyntaxRef).toHaveBeenCalled()
  })

  it('帮助菜单：问题反馈 → onReportIssue', async () => {
    const p = setup()
    await openMenu('帮助')
    await userEvent.click(await screen.findByRole('menuitem', { name: /问题反馈/ }))
    expect(p.onReportIssue).toHaveBeenCalled()
  })

  it('校验通过显示状态胶囊', () => {
    setup({ errorCount: 0, warnCount: 0, hasProgram: true })
    expect(screen.getByText('校验通过')).toBeInTheDocument()
  })

  it('视图菜单：设置... → onOpenSettings', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '设置...' }))
    expect(p.onOpenSettings).toHaveBeenCalled()
  })

  it('视图菜单：放大字号 → onZoomIn（占位已接通、不再 disabled）', async () => {
    const p = setup()
    await openMenu('视图')
    const item = await screen.findByRole('menuitem', { name: /放大/ })
    expect(item).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(item)
    expect(p.onZoomIn).toHaveBeenCalled()
  })

  it('视图菜单：重置字号 → onZoomReset', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: /重置字号/ }))
    expect(p.onZoomReset).toHaveBeenCalled()
  })

  it('导出故事包：有项目且无错误时可点并回调', async () => {
    const p = setup({ projectName: '雾港之夜', errorCount: 0 })
    await openMenu('文件')
    await userEvent.click(await screen.findByRole('menuitem', { name: '导出故事包（.kip）...' }))
    expect(p.onExportKip).toHaveBeenCalled()
  })

  it('导出独立网页：有项目且无错误时可点并回调', async () => {
    const p = setup({ projectName: '雾港之夜', errorCount: 0 })
    await openMenu('文件')
    await userEvent.click(await screen.findByRole('menuitem', { name: '导出独立网页...' }))
    expect(p.onExportWebpage).toHaveBeenCalled()
  })

  it('导出故事包：无项目时禁用', async () => {
    setup({ projectName: null })
    await openMenu('文件')
    expect(await screen.findByRole('menuitem', { name: '导出故事包（.kip）...' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('导出故事包：有校验错误时禁用', async () => {
    setup({ projectName: '雾港之夜', errorCount: 2 })
    await openMenu('文件')
    expect(await screen.findByRole('menuitem', { name: '导出故事包（.kip）...' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('视图菜单含「AI 面板」开关，点击 toggle ai', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'AI 面板' }))
    expect(p.onToggleView).toHaveBeenCalledWith('ai')
  })
})
