import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsSettings } from './ShortcutsSettings'

describe('ShortcutsSettings', () => {
  it('按分组列出命令，显示当前绑定', () => {
    render(<ShortcutsSettings overrides={{}} onChange={() => {}} />)
    expect(screen.getByText('保存')).toBeInTheDocument()
    expect(screen.getByText('Kiny 语法参考')).toBeInTheDocument()
    expect(screen.getByText('文件')).toBeInTheDocument() // 分组标题
    // 保存的默认绑定显示 Ctrl+S（非 mac 环境）
    expect(screen.getByLabelText('修改「保存」快捷键')).toHaveTextContent('Ctrl+S')
  })

  it('捕获新组合 → onChange 落覆盖', () => {
    const onChange = vi.fn()
    render(<ShortcutsSettings overrides={{}} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('修改「保存」快捷键'))
    fireEvent.keyDown(screen.getByLabelText('修改「保存」快捷键'), { key: 'K', ctrlKey: true, shiftKey: true })
    expect(onChange).toHaveBeenCalledWith({ save: 'Mod+Shift+K' })
  })

  it('冲突组合被阻止，报占用命令名，不落覆盖', () => {
    const onChange = vi.fn()
    render(<ShortcutsSettings overrides={{}} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('修改「保存」快捷键'))
    fireEvent.keyDown(screen.getByLabelText('修改「保存」快捷键'), { key: 'O', ctrlKey: true }) // 撞打开项目
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('打开项目')
  })

  it('非法组合（裸字母）被阻止', () => {
    const onChange = vi.fn()
    render(<ShortcutsSettings overrides={{}} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('修改「保存」快捷键'))
    fireEvent.keyDown(screen.getByLabelText('修改「保存」快捷键'), { key: 'k' }) // 无修饰键
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('设为等于默认值 → 清掉覆盖（不冗余存默认）', () => {
    const onChange = vi.fn()
    render(<ShortcutsSettings overrides={{ save: 'Mod+Shift+K' }} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('修改「保存」快捷键'))
    fireEvent.keyDown(screen.getByLabelText('修改「保存」快捷键'), { key: 'S', ctrlKey: true }) // 回到默认 Mod+S
    expect(onChange).toHaveBeenCalledWith({}) // 覆盖被删
  })

  it('逐项恢复默认', async () => {
    const onChange = vi.fn()
    render(<ShortcutsSettings overrides={{ help: 'F2' }} onChange={onChange} />)
    // help 行显示 F2（覆盖）
    expect(screen.getByLabelText('修改「Kiny 语法参考」快捷键')).toHaveTextContent('F2')
    await userEvent.click(screen.getByLabelText('「Kiny 语法参考」恢复默认'))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('全部恢复默认', async () => {
    const onChange = vi.fn()
    render(<ShortcutsSettings overrides={{ help: 'F2', save: 'Mod+Shift+K' }} onChange={onChange} />)
    await userEvent.click(screen.getByText('全部恢复默认'))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('残留冲突（覆盖撞他命令默认键）→ 显示冲突横幅并标记冲突行', () => {
    // openProject 被改到 Mod+N，与 newProject 默认键撞车
    render(<ShortcutsSettings overrides={{ openProject: 'Mod+N' }} onChange={() => {}} />)
    const banner = screen.getByText(/存在冲突/)
    expect(banner).toBeInTheDocument()
    expect(banner.parentElement).toHaveTextContent('新建项目')
    expect(banner.parentElement).toHaveTextContent('打开项目')
  })

  it('无冲突时不显示冲突横幅', () => {
    render(<ShortcutsSettings overrides={{}} onChange={() => {}} />)
    expect(screen.queryByText(/存在冲突/)).not.toBeInTheDocument()
  })

  it('readonly 原生键只展示、不可捕获', () => {
    render(<ShortcutsSettings overrides={{}} onChange={() => {}} />)
    expect(screen.getByText('复制')).toBeInTheDocument()
    // 复制无「修改」按钮
    expect(screen.queryByLabelText('修改「复制」快捷键')).not.toBeInTheDocument()
  })
})
