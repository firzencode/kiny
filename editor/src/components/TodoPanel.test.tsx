import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TodoPanel } from './TodoPanel'
import type { TodoItem } from '../todo/scanTodos'

const items: TodoItem[] = [
  { path: 'a.kin', line: 3, tag: 'TODO', text: '补写分支' },
  { path: 'a.kin', line: 8, tag: 'FIXME', text: '修 bug' },
  { path: 'sub/b.kin', line: 1, tag: 'TODO', text: '起标题' },
]

describe('TodoPanel', () => {
  it('按文件分组渲染、总数徽章正确', () => {
    render(<TodoPanel todos={items} onJump={vi.fn()} />)
    expect(screen.getByText('待办')).toBeInTheDocument()
    expect(screen.getByText('3', { selector: '.outline-tag' })).toBeInTheDocument() // 总数徽章
    expect(screen.getByText('a.kin')).toBeInTheDocument()
    expect(screen.getByText('b.kin')).toBeInTheDocument() // 取末段文件名
    expect(screen.getByText('补写分支')).toBeInTheDocument()
  })

  it('TODO / FIXME 徽章区分', () => {
    const { container } = render(<TodoPanel todos={items} onJump={vi.fn()} />)
    expect(container.querySelectorAll('.todo-badge.todo')).toHaveLength(2)
    expect(container.querySelectorAll('.todo-badge.fixme')).toHaveLength(1)
  })

  it('点击条目触发跳转（path + line）', () => {
    const onJump = vi.fn()
    render(<TodoPanel todos={items} onJump={onJump} />)
    fireEvent.click(screen.getByText('修 bug'))
    expect(onJump).toHaveBeenCalledWith('a.kin', 8)
  })

  it('点击文件组标题跳到该文件首个待办', () => {
    const onJump = vi.fn()
    render(<TodoPanel todos={items} onJump={onJump} />)
    fireEvent.click(screen.getByText('b.kin'))
    expect(onJump).toHaveBeenCalledWith('sub/b.kin', 1)
  })

  it('空态占位', () => {
    render(<TodoPanel todos={[]} onJump={vi.fn()} />)
    expect(screen.getByText('暂无待办')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('折叠态不渲染列表、折叠按钮 aria', () => {
    render(<TodoPanel todos={items} onJump={vi.fn()} collapsed onToggleCollapse={vi.fn()} />)
    expect(screen.queryByText('补写分支')).toBeNull()
    expect(screen.getByRole('button', { name: '展开待办' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('无描述条目显示占位文案', () => {
    render(<TodoPanel todos={[{ path: 'a.kin', line: 1, tag: 'TODO', text: '' }]} onJump={vi.fn()} />)
    const item = screen.getByText('（无描述）')
    expect(within(item.closest('.todo-item')!).getByText('TODO')).toBeInTheDocument()
  })
})
