import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewProjectDialog } from './NewProjectDialog'

function setup(over: Partial<React.ComponentProps<typeof NewProjectDialog>> = {}) {
  // 注意：先解析 override 再 render，不用 JSX 尾部 {...over} 展开——
  // 展开会覆盖同名 prop，但被覆盖前捕获的默认 spy 闭包变量不会更新，
  // 导致用例断言检查了错误的（从未被调用的）spy。
  const onBrowse = over.onBrowse ?? vi.fn(async () => 'D:\\小说')
  const onCreate = over.onCreate ?? vi.fn(async () => null as string | null)
  const onCancel = over.onCancel ?? vi.fn()
  render(<NewProjectDialog open onBrowse={onBrowse} onCreate={onCreate} onCancel={onCancel} />)
  return { onBrowse, onCreate, onCancel }
}

describe('NewProjectDialog', () => {
  it('open=false → 不渲染', () => {
    const { container } = render(
      <NewProjectDialog open={false} onBrowse={vi.fn()} onCreate={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('名 / 位置齐备前「创建」置灰，齐备后可点', async () => {
    const { onBrowse } = setup()
    const create = screen.getByRole('button', { name: '创建' })
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('项目名称'), '雾港')
    expect(create).toBeDisabled() // 仍缺位置
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    expect(onBrowse).toHaveBeenCalledOnce()
    await waitFor(() => expect(create).toBeEnabled())
  })

  it('名字全是非法字符 → 「创建」置灰', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('项目名称'), '/:*?')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => {})
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
  })

  it('点创建 → 以 (位置, 名) 调 onCreate；成功不显错', async () => {
    const { onCreate } = setup()
    await userEvent.type(screen.getByLabelText('项目名称'), '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(onCreate).toHaveBeenCalledWith('D:\\小说', '雾港')
  })

  it('onCreate 返错误串 → 内联显示、弹窗留驻', async () => {
    const { onCreate } = setup({ onCreate: vi.fn(async () => '目标位置已存在「雾港」，无法创建') })
    await userEvent.type(screen.getByLabelText('项目名称'), '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByText(/已存在/)).toBeInTheDocument()
    expect(onCreate).toHaveBeenCalled()
  })

  it('浏览取消（返 null）→ 位置保持空、创建仍置灰', async () => {
    setup({ onBrowse: vi.fn(async () => null) })
    await userEvent.type(screen.getByLabelText('项目名称'), '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => {})
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
  })

  it('创建进行中（busy）→「浏览…」按钮与项目名称框禁用', async () => {
    let resolveCreate: (v: string | null) => void = () => {}
    const onCreate = vi.fn(() => new Promise<string | null>((resolve) => { resolveCreate = resolve }))
    setup({ onCreate })
    await userEvent.type(screen.getByLabelText('项目名称'), '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(screen.getByRole('button', { name: '浏览…' })).toBeDisabled()
    expect(screen.getByLabelText('项目名称')).toBeDisabled()
    resolveCreate(null) // 收尾：避免未处理的 pending promise 影响后续用例
  })

  it('Esc → onCancel', async () => {
    const { onCancel } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('点遮罩空白处 → 不关闭；点 × → 关闭', async () => {
    const { onCancel } = setup()
    const scrim = document.querySelector('.settings-scrim') as HTMLElement
    await userEvent.click(scrim) // 点空白遮罩不应触发关闭
    expect(onCancel).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '关闭' })) // × 才关
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('名 / 位置齐备后按 Enter → 触发 onCreate', async () => {
    const { onCreate } = setup()
    const input = screen.getByLabelText('项目名称')
    await userEvent.type(input, '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled())
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('D:\\小说', '雾港')
  })

  it('输入法合成态（isComposing）下按 Enter → 不触发 onCreate', async () => {
    const { onCreate } = setup()
    const input = screen.getByLabelText('项目名称')
    await userEvent.type(input, '雾港')
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled())
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'isComposing', { value: true })
    input.dispatchEvent(ev)
    expect(onCreate).not.toHaveBeenCalled()
  })
})
