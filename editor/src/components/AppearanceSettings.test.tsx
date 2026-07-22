import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppearanceSettings } from './AppearanceSettings'
import { type CustomTheme, exportTheme } from '../state/themes'

/** 受控组件——用有状态壳承接 onChange，模拟真实编辑流。 */
function Harness({
  initialActive = 'dark',
  initial = [] as CustomTheme[],
  saveThemeFile = vi.fn(async () => true),
}: { initialActive?: string; initial?: CustomTheme[]; saveThemeFile?: (n: string, c: string) => Promise<boolean> }) {
  const [active, setActive] = useState(initialActive)
  const [themes, setThemes] = useState<CustomTheme[]>(initial)
  return (
    <div>
      <span data-testid="active">{active}</span>
      <span data-testid="count">{themes.length}</span>
      <span data-testid="dump">{JSON.stringify(themes)}</span>
      <AppearanceSettings
        activeThemeId={active}
        customThemes={themes}
        onChange={(a, t) => { setActive(a); setThemes(t) }}
        saveThemeFile={saveThemeFile}
      />
    </div>
  )
}

const active = () => screen.getByTestId('active').textContent
const count = () => screen.getByTestId('count').textContent
const dump = () => JSON.parse(screen.getByTestId('dump').textContent || '[]') as CustomTheme[]

describe('AppearanceSettings', () => {
  it('列出预设（含素雪白）+ 选中预设回调 active', async () => {
    render(<Harness />)
    expect(screen.getByRole('radio', { name: /石板墨/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /素雪白/ })).toBeInTheDocument() // T074 第三预设
    await userEvent.click(screen.getByRole('radio', { name: /象牙稿/ }))
    expect(active()).toBe('light')
  })

  it('选中素雪白预设 → active=plain', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('radio', { name: /素雪白/ }))
    expect(active()).toBe('plain')
  })

  it('新建自定义主题 → 追加、选中、进入编辑（取色面板出现）', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '＋ 新建自定义主题' }))
    expect(count()).toBe('1')
    expect(active()).toBe(dump()[0]!.id) // 新建即选中
    expect(screen.getByLabelText('--accent')).toBeInTheDocument() // 取色面板
  })

  it('编辑取色 → override 写入草稿', async () => {
    const t: CustomTheme = { id: 'c1', name: '暗夜', base: 'dark', overrides: {} }
    render(<Harness initialActive="c1" initial={[t]} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑 暗夜' }))
    fireEvent.change(screen.getByLabelText('--accent 十六进制'), { target: { value: '#ff0000' } })
    expect(dump()[0]!.overrides['--accent']).toBe('#ff0000')
  })

  it('删除活动自定义主题 → 回落其基底预设', async () => {
    const t: CustomTheme = { id: 'c1', name: '林间', base: 'light', overrides: {} }
    render(<Harness initialActive="c1" initial={[t]} />)
    await userEvent.click(screen.getByRole('button', { name: '删除 林间' }))
    expect(count()).toBe('0')
    expect(active()).toBe('light') // 回落基底
  })

  it('重命名：Enter 提交新名', async () => {
    const t: CustomTheme = { id: 'c1', name: '旧名', base: 'dark', overrides: {} }
    render(<Harness initialActive="c1" initial={[t]} />)
    await userEvent.click(screen.getByRole('button', { name: '重命名 旧名' }))
    const input = screen.getByLabelText('主题名称')
    await userEvent.clear(input)
    await userEvent.type(input, '新名{Enter}')
    expect(dump()[0]!.name).toBe('新名')
  })

  it('导出 → 经 saveThemeFile 落盘（原生保存对话框），文件名 + 序列化内容正确', async () => {
    const t: CustomTheme = { id: 'c1', name: '林夜', base: 'dark', overrides: { '--accent': '#ff0000' } }
    const saveThemeFile = vi.fn(async () => true)
    render(<Harness initialActive="c1" initial={[t]} saveThemeFile={saveThemeFile} />)
    await userEvent.click(screen.getByRole('button', { name: '导出 林夜' }))
    expect(saveThemeFile).toHaveBeenCalledWith('林夜.kiny-theme.json', exportTheme(t))
  })

  it('导出失败 → 显示错误提示，不抛未捕获异常', async () => {
    const t: CustomTheme = { id: 'c1', name: '林夜', base: 'dark', overrides: {} }
    const saveThemeFile = vi.fn(async () => { throw new Error('磁盘满') })
    render(<Harness initialActive="c1" initial={[t]} saveThemeFile={saveThemeFile} />)
    await userEvent.click(screen.getByRole('button', { name: '导出 林夜' }))
    expect(await screen.findByText(/导出失败：磁盘满/)).toBeInTheDocument()
  })

  it('低对比 override → 显示非阻塞对比度提示', async () => {
    const t: CustomTheme = { id: 'c1', name: '低对比', base: 'dark', overrides: { '--text': '#666666', '--bg-0': '#5a5a5a' } }
    render(<Harness initialActive="c1" initial={[t]} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑 低对比' }))
    const warn = screen.getByText(/对比度偏低/)
    expect(warn).toBeInTheDocument()
    expect(within(warn.closest('.theme-contrast-warn')!).getByText(/正文/)).toBeInTheDocument()
  })

  it('恢复变量基底值（↺）→ 移除该 override', async () => {
    const t: CustomTheme = { id: 'c1', name: 'x', base: 'dark', overrides: { '--accent': '#ff0000' } }
    render(<Harness initialActive="c1" initial={[t]} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑 x' }))
    await userEvent.click(screen.getByRole('button', { name: '恢复 --accent 基底值' }))
    expect('--accent' in dump()[0]!.overrides).toBe(false)
  })
})
