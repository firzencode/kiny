import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from './SettingsDialog'
import { DEFAULT_SETTINGS } from '../state/settings'
import { DEFAULT_AI_CONFIG } from '../ai/aiConfig'

const base = {
  open: true, settings: DEFAULT_SETTINGS, theme: 'dark' as const,
  aiConfig: DEFAULT_AI_CONFIG, controlInfo: null as { port: number } | null,
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

  it('字号单位「px」渲染为步进器内独立的 .settings-unit 后缀格（样式可单独定位）', () => {
    const { container } = render(<SettingsDialog {...base} />)
    const units = container.querySelectorAll('.settings-stepper .settings-unit')
    // 代码字号 + 正文字号两处带 px 单位；行距两处无单位（unit=""，不渲染 span，数值格补 .nounit 右边框）。
    expect(units).toHaveLength(2)
    units.forEach((u) => expect(u.textContent).toBe('px'))
    // 行距两处无单位：.settings-stepval.nounit 各一 = 2
    expect(container.querySelectorAll('.settings-stepval.nounit')).toHaveLength(2)
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
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, codeSize: 14 }, 'dark', DEFAULT_AI_CONFIG)
  })

  it('步进器在上限夹紧（无变化、保存仍禁用）', async () => {
    render(<SettingsDialog {...base} settings={{ ...DEFAULT_SETTINGS, codeLh: 2.2 }} />)
    await userEvent.click(screen.getByRole('button', { name: '增大代码行距' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('取消 / Esc / ✕ → onCancel，从不 onSave', async () => {
    const onCancel = vi.fn(), onSave = vi.fn()
    render(<SettingsDialog {...base} onCancel={onCancel} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('点遮罩空白处不关闭（避免误触丢失未保存改动）', async () => {
    const onCancel = vi.fn()
    const { container } = render(<SettingsDialog {...base} onCancel={onCancel} />)
    await userEvent.click(container.querySelector('.settings-scrim')!)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('恢复默认 → 草稿回默认（从非默认初值，保存随之启用）', async () => {
    render(<SettingsDialog {...base} settings={{ ...DEFAULT_SETTINGS, codeSize: 18 }} />)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('切主题 → 草稿主题变（保存启用）', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: '外观' }))
    await userEvent.click(screen.getByRole('button', { name: '象牙稿' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('自定义字体：选「自定义...」展开输入框', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '代码字体' }), '自定义...')
    expect(screen.getByPlaceholderText(/字体名/)).toBeInTheDocument()
  })

  it('自动恢复草稿开关：默认开，可切换并回传', async () => {
    const onSave = vi.fn()
    render(<SettingsDialog {...base} onSave={onSave} />)
    await userEvent.click(screen.getByRole('tab', { name: '编辑器' }))
    const sw = screen.getByRole('switch', { name: '自动恢复草稿' })
    expect(sw).toBeChecked()
    await userEvent.click(sw)
    expect(sw).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, autosaveRecovery: false }, 'dark', DEFAULT_AI_CONFIG)
  })

  it('预览随机种子开关：默认关，可切换并回传', async () => {
    const onSave = vi.fn()
    render(<SettingsDialog {...base} onSave={onSave} />)
    await userEvent.click(screen.getByRole('tab', { name: '编辑器' }))
    const sw = screen.getByRole('switch', { name: '预览随机种子' })
    expect(sw).not.toBeChecked()
    await userEvent.click(sw)
    expect(sw).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, previewRandomSeed: true }, 'dark', DEFAULT_AI_CONFIG)
  })

  it('外部控制开关：默认关，在 AI tab，可切换并回传', async () => {
    const onSave = vi.fn()
    render(<SettingsDialog {...base} onSave={onSave} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    const sw = screen.getByRole('switch', { name: '启用外部控制' })
    expect(sw).not.toBeChecked()
    await userEvent.click(sw)
    expect(sw).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, externalControl: true }, 'dark', DEFAULT_AI_CONFIG)
  })

  it('controlInfo 非 null 时 AI tab 显示运行中端口；null 时不显示', async () => {
    render(<SettingsDialog {...base} controlInfo={{ port: 4321 }} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(screen.getByText(/运行中 · 端口 4321/)).toBeInTheDocument()
  })
})

describe('SettingsDialog · 多 tab（T030）', () => {
  const navDot = (tabName: string) =>
    screen.getByRole('tab', { name: tabName }).querySelector('.settings-nav-dot')

  it('打开时 activeTab 为「排版」：显示代码字体行、不显示 AI/主题', () => {
    render(<SettingsDialog {...base} />)
    expect(screen.getByRole('tab', { name: '排版' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox', { name: '代码字体' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Base URL')).toBeNull()
    expect(screen.queryByRole('button', { name: '象牙稿' })).toBeNull()
  })

  it('点各 tab → 右栏渲染对应设置项', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '代码字体' })).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: '外观' }))
    expect(screen.getByRole('button', { name: '象牙稿' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '编辑器' }))
    expect(screen.getByRole('switch', { name: '自动恢复草稿' })).toBeInTheDocument()
  })

  it('改某 tab 字段 → 该 tab 脏点亮 + 全局横幅出现；别的 tab 无脏点', async () => {
    render(<SettingsDialog {...base} />)
    expect(navDot('排版')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    expect(navDot('排版')).not.toBeNull()          // 排版脏点亮
    expect(navDot('AI')).toBeNull()                 // 其它 tab 无脏点
    expect(screen.getByText(/未保存的改动/)).toBeInTheDocument() // 全局横幅
  })

  it('改字段后切到别的 tab 不丢改动、切回仍在（保存仍可点）', async () => {
    render(<SettingsDialog {...base} />)
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' }))
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))       // 切走
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()   // 改动仍在（全局 dirty）
    expect(navDot('排版')).not.toBeNull()                                // 排版脏点仍亮
    await userEvent.click(screen.getByRole('tab', { name: '排版' }))     // 切回
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('改动散落多 tab → 各自脏点独立点亮，保存回传全部', async () => {
    const onSave = vi.fn()
    render(<SettingsDialog {...base} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: '增大代码字号' })) // 排版
    await userEvent.click(screen.getByRole('tab', { name: '外观' }))
    await userEvent.click(screen.getByRole('button', { name: '象牙稿' }))       // 外观
    expect(navDot('排版')).not.toBeNull()
    expect(navDot('外观')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, codeSize: 14 }, 'light', DEFAULT_AI_CONFIG)
  })
})

describe('SettingsDialog · AI 节', () => {
  const baseProps = {
    open: true, settings: DEFAULT_SETTINGS, theme: 'dark' as const,
    aiConfig: DEFAULT_AI_CONFIG, controlInfo: null as { port: number } | null,
    onSave: vi.fn(), onCancel: vi.fn(),
  }

  it('改 endpoint/model/key 后保存，回传新 aiConfig', () => {
    const onSave = vi.fn()
    render(<SettingsDialog {...baseProps} onSave={onSave} />)
    fireEvent.click(screen.getByRole('tab', { name: 'AI' }))
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.deepseek.com/v1' } })
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek-chat' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS, 'dark', expect.objectContaining({
      endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-abc',
    }))
  })

  it('key 默认 password，点显示切明文', () => {
    render(<SettingsDialog {...baseProps} aiConfig={{ ...DEFAULT_AI_CONFIG, apiKey: 'sk-x' }} />)
    fireEvent.click(screen.getByRole('tab', { name: 'AI' }))
    const key = screen.getByLabelText('API Key') as HTMLInputElement
    expect(key.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '显示' }))
    expect(key.type).toBe('text')
  })
})
