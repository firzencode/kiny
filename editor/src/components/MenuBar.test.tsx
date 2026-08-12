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
    activeThemeId: 'dark',
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
    onThemeRef: vi.fn(),
    onAbout: vi.fn(),
    onReportIssue: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onOpenTheme: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    shortcuts: {},
    onExportKip: vi.fn(),
    onExportWebpage: vi.fn(),
    onExportManuscript: vi.fn(),
    onSearchInFiles: vi.fn(),
    onRenameNode: vi.fn(),
    hasSavedLayout: false,
    onSaveLayout: vi.fn(),
    onRestoreMyLayout: vi.fn(),
    onRestoreDefaultLayout: vi.fn(),
    recentProjects: [] as { dir: string; name: string }[],
    onOpenRecent: vi.fn(),
    onCloseProject: vi.fn(),
    controlInfo: null as { port: number } | null,
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

  it('controlInfo 非 null 时常驻显示外部控制端口；null 时不显示', () => {
    setup({ controlInfo: null })
    expect(screen.queryByText(/外部控制已启用/)).toBeNull()
  })

  it('controlInfo 非 null 时显示端口号', () => {
    setup({ controlInfo: { port: 5173 } })
    expect(screen.getByText(/外部控制已启用 · 端口 5173/)).toBeInTheDocument()
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

  it('视图菜单：切主题（含素雪白）、切开关', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '主题：象牙稿' }))
    expect(p.onSetTheme).toHaveBeenCalledWith('light')
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '主题：素雪白' })) // T074 第三预设
    expect(p.onSetTheme).toHaveBeenCalledWith('plain')
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

  it('帮助菜单：作品主题参考 → onThemeRef', async () => {
    const p = setup()
    await openMenu('帮助')
    await userEvent.click(await screen.findByRole('menuitem', { name: /作品主题参考/ }))
    expect(p.onThemeRef).toHaveBeenCalled()
  })

  it('帮助菜单：问题反馈 → onReportIssue', async () => {
    const p = setup()
    await openMenu('帮助')
    await userEvent.click(await screen.findByRole('menuitem', { name: /问题反馈/ }))
    expect(p.onReportIssue).toHaveBeenCalled()
  })

  it('关闭项目：有项目时可点并回调', async () => {
    const p = setup({ projectName: '雾港之夜' })
    await openMenu('文件')
    await userEvent.click(await screen.findByRole('menuitem', { name: '关闭项目' }))
    expect(p.onCloseProject).toHaveBeenCalled()
  })

  it('关闭项目：无项目时禁用', async () => {
    setup({ projectName: null })
    await openMenu('文件')
    expect(await screen.findByRole('menuitem', { name: '关闭项目' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('最近打开：无最近项目时禁用', async () => {
    setup({ recentProjects: [] })
    await openMenu('文件')
    expect(await screen.findByRole('menuitem', { name: '最近打开' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('最近打开：悬停展开子菜单，点条目回调对应目录', async () => {
    const p = setup({ recentProjects: [{ dir: '/a', name: '甲项目' }, { dir: '/b', name: '乙项目' }] })
    await openMenu('文件')
    await userEvent.hover(await screen.findByRole('menuitem', { name: '最近打开' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '甲项目' }))
    expect(p.onOpenRecent).toHaveBeenCalledWith('/a')
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

  it('项目设置：有项目时可点并回调', async () => {
    const p = setup({ projectName: '雾港之夜' })
    await openMenu('文件')
    await userEvent.click(await screen.findByRole('menuitem', { name: '项目设置...' }))
    expect(p.onOpenProjectSettings).toHaveBeenCalled()
  })

  it('项目设置：无项目时禁用', async () => {
    setup({ projectName: null })
    await openMenu('文件')
    expect(await screen.findByRole('menuitem', { name: '项目设置...' })).toHaveAttribute('aria-disabled', 'true')
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

  it('视图菜单：保存当前布局 → onSaveLayout', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '保存当前布局' }))
    expect(p.onSaveLayout).toHaveBeenCalled()
  })

  it('视图菜单：恢复默认布局 → onRestoreDefaultLayout', async () => {
    const p = setup()
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '恢复默认布局' }))
    expect(p.onRestoreDefaultLayout).toHaveBeenCalled()
  })

  it('无快照时不渲染「恢复我的布局」', async () => {
    setup({ hasSavedLayout: false })
    await openMenu('视图')
    // 先确认菜单已展开（其它项在场），再断言目标项缺席
    expect(await screen.findByRole('menuitem', { name: '保存当前布局' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '恢复我的布局' })).not.toBeInTheDocument()
  })

  it('有快照时渲染「恢复我的布局」并回调', async () => {
    const p = setup({ hasSavedLayout: true })
    await openMenu('视图')
    await userEvent.click(await screen.findByRole('menuitem', { name: '恢复我的布局' }))
    expect(p.onRestoreMyLayout).toHaveBeenCalled()
  })
})
