import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { SavesPanel } from './SavesPanel'
import { AUTO_SAVE_ID, type ViewerSave } from '../load/saves'

const auto: ViewerSave = { id: AUTO_SAVE_ID, kind: 'auto', seed: 1, seq: [], meta: { timestamp: 1_700_000_000_000, label: '开场白。' } }
const manual: ViewerSave = { id: 'm1', kind: 'manual', seed: 1, seq: [], meta: { timestamp: 1_700_000_100_000, label: '你向左走。' } }

const noop = () => {}
function panel(props: Partial<ComponentProps<typeof SavesPanel>> = {}) {
  return (
    <SavesPanel
      saves={[auto, manual]}
      onSaveNew={noop} onLoad={noop} onDelete={noop} onClose={noop}
      notice={null}
      {...props}
    />
  )
}

describe('SavesPanel', () => {
  it('空列表显示提示文案', () => {
    render(panel({ saves: [] }))
    expect(screen.getByText('还没有存档。')).toBeInTheDocument()
  })

  it('列出每条存档的标签与「自动」标记', () => {
    render(panel())
    expect(screen.getByText('开场白。')).toBeInTheDocument()
    expect(screen.getByText('你向左走。')).toBeInTheDocument()
    expect(screen.getByText('自动')).toBeInTheDocument()
  })

  it('点「＋ 存档当前进度」触发回调', async () => {
    const onSaveNew = vi.fn()
    render(panel({ onSaveNew }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 存档当前进度' }))
    expect(onSaveNew).toHaveBeenCalledOnce()
  })

  it('点「读取」把该条存档回传', async () => {
    const onLoad = vi.fn()
    render(panel({ onLoad }))
    await userEvent.click(screen.getAllByRole('button', { name: '读取' })[0]!)
    expect(onLoad).toHaveBeenCalledWith(auto)
  })

  it('删除是两步确认：先出「确定删除?」，再点才回调', async () => {
    const onDelete = vi.fn()
    render(panel({ onDelete }))
    await userEvent.click(screen.getAllByRole('button', { name: '删除存档' })[0]!)
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '确定删除?' }))
    expect(onDelete).toHaveBeenCalledWith(AUTO_SAVE_ID)
  })

  it('notice 以 alert 角色呈现', () => {
    render(panel({ notice: '该存档对应的故事已更新，无法读取此存档。' }))
    expect(screen.getByRole('alert')).toHaveTextContent('该存档对应的故事已更新')
  })

  it('点关闭按钮触发 onClose', async () => {
    const onClose = vi.fn()
    render(panel({ onClose }))
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
