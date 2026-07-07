import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import type { Manifest } from '../files/gateway'

const MANIFEST: Manifest = { name: '雾港', version: '1.0.0', engine: '0.5.0', entry: 'main.kin' }

function setup(over: Partial<ComponentProps<typeof ProjectSettingsDialog>> = {}) {
  const props = {
    open: true,
    manifest: MANIFEST,
    kinFiles: ['main.kin', '末.kin'],
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  render(<ProjectSettingsDialog {...props} />)
  return props
}

describe('ProjectSettingsDialog', () => {
  it('open=false 不渲染', () => {
    setup({ open: false })
    expect(screen.queryByRole('dialog', { name: '项目设置' })).toBeNull()
  })

  it('以 manifest 为种子填充字段；engine 只读展示', () => {
    setup()
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe('雾港')
    expect((screen.getByLabelText('启动入口') as HTMLSelectElement).value).toBe('main.kin')
    expect((screen.getByLabelText('项目版本') as HTMLInputElement).value).toBe('1.0.0')
    expect(screen.getByLabelText('引擎版本').textContent).toBe('0.5.0')
    // 无 engine 输入框（只读）
    expect(screen.queryByRole('textbox', { name: '引擎版本' })).toBeNull()
  })

  it('启动入口下拉选项 = 传入的 .kin 文件集合', () => {
    setup()
    const opts = Array.from((screen.getByLabelText('启动入口') as HTMLSelectElement).options).map((o) => o.value)
    expect(opts).toEqual(['main.kin', '末.kin'])
  })

  it('draft == manifest 时保存不可点；改任一字段后可点', async () => {
    setup()
    const save = screen.getByRole('button', { name: '保存' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('项目名称'), '改')
    expect(save).toBeEnabled()
  })

  it('切换启动入口后可保存，onSave 收到新 entry', async () => {
    const p = setup()
    await userEvent.selectOptions(screen.getByLabelText('启动入口'), '末.kin')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(p.onSave).toHaveBeenCalledWith({ ...MANIFEST, entry: '末.kin' })
  })

  it('version 清空 = 保留原值：不算脏（保存不可点）', async () => {
    setup()
    await userEvent.clear(screen.getByLabelText('项目版本'))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('version 清空后又改别的字段保存 → onSave 的 version 回退为原值', async () => {
    const p = setup()
    await userEvent.clear(screen.getByLabelText('项目版本'))
    await userEvent.type(screen.getByLabelText('项目名称'), '改')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(p.onSave).toHaveBeenCalledWith({ ...MANIFEST, name: '雾港改', version: '1.0.0' })
  })

  it('取消按钮 → onCancel', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(p.onCancel).toHaveBeenCalled()
  })

  it('Esc → onCancel', async () => {
    const p = setup()
    await userEvent.keyboard('{Escape}')
    expect(p.onCancel).toHaveBeenCalled()
  })

  it('防御：当前 entry 不在 kinFiles 时下拉仍含它', () => {
    setup({ kinFiles: ['其他.kin'], manifest: { ...MANIFEST, entry: 'main.kin' } })
    const opts = Array.from((screen.getByLabelText('启动入口') as HTMLSelectElement).options).map((o) => o.value)
    expect(opts).toContain('main.kin')
  })
})
