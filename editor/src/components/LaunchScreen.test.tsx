import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LaunchScreen, formatRelative } from './LaunchScreen'

const RECENT = [
  { dir: 'D:\\projects\\fog-harbor', name: '雾港之夜', ts: 200 },
  { dir: '/home/u/star', name: '星辰彼端', ts: 100 },
]

function renderLaunch(over: Partial<React.ComponentProps<typeof LaunchScreen>> = {}) {
  const onNewProject = vi.fn()
  const onOpenProject = vi.fn()
  const onOpenRecent = vi.fn()
  const onRemoveRecent = vi.fn()
  render(
    <LaunchScreen
      theme="dark"
      recent={RECENT}
      onNewProject={onNewProject}
      onOpenProject={onOpenProject}
      onOpenRecent={onOpenRecent}
      onRemoveRecent={onRemoveRecent}
      {...over}
    />,
  )
  return { onNewProject, onOpenProject, onOpenRecent, onRemoveRecent }
}

describe('LaunchScreen', () => {
  it('渲染新建 / 打开项目主操作，点击回调', async () => {
    const { onNewProject, onOpenProject } = renderLaunch()
    await userEvent.click(screen.getByRole('button', { name: /新建项目/ }))
    expect(onNewProject).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: /打开项目/ }))
    expect(onOpenProject).toHaveBeenCalledOnce()
  })

  it('列出最近项目（名 + 路径），点击带目录回调', async () => {
    const { onOpenRecent } = renderLaunch()
    expect(screen.getByText('雾港之夜')).toBeInTheDocument()
    expect(screen.getByText('星辰彼端')).toBeInTheDocument()
    expect(screen.getByText('D:\\projects\\fog-harbor')).toBeInTheDocument()
    await userEvent.click(screen.getByText('雾港之夜'))
    expect(onOpenRecent).toHaveBeenCalledWith('D:\\projects\\fog-harbor')
  })

  it('最近项目为空 → 显示引导空态、无列表项', () => {
    renderLaunch({ recent: [] })
    expect(screen.getByText(/还没有项目/)).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('每个最近项目渲染删除按钮，点击回调带对应项目', async () => {
    const { onRemoveRecent, onOpenRecent } = renderLaunch()
    const del = screen.getByRole('button', { name: '从最近项目移除 雾港之夜' })
    await userEvent.click(del)
    expect(onRemoveRecent).toHaveBeenCalledWith({
      dir: 'D:\\projects\\fog-harbor', name: '雾港之夜', ts: 200,
    })
    // 点删除不应触发打开项目
    expect(onOpenRecent).not.toHaveBeenCalled()
  })

  it('最近项目为空 → 无删除按钮', () => {
    renderLaunch({ recent: [] })
    expect(screen.queryByRole('button', { name: /从最近项目移除/ })).toBeNull()
  })
})

describe('formatRelative', () => {
  const now = 1_000_000_000_000
  it('1 分钟内 → 刚刚', () => {
    expect(formatRelative(now - 30_000, now)).toBe('刚刚')
  })
  it('分钟级', () => {
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 分钟前')
  })
  it('小时级', () => {
    expect(formatRelative(now - 3 * 3600_000, now)).toBe('3 小时前')
  })
  it('昨天', () => {
    expect(formatRelative(now - 26 * 3600_000, now)).toBe('昨天')
  })
  it('多天前', () => {
    expect(formatRelative(now - 5 * 24 * 3600_000, now)).toBe('5 天前')
  })
})
