import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Explorer } from './Explorer'

const base = {
  projectName: 'P', dirtyMap: {}, activeFile: null, entry: 'main.kin',
  onOpenFile: () => {}, onCreateFile: () => {},
  onRename: () => {}, onDelete: () => {}, onCreateFolder: () => {}, onMove: () => {},
}

it('渲染多层树，文件夹可折叠', () => {
  render(<Explorer {...base}
    entries={[{ path: 'main.kin', isKin: true }, { path: 'chapters/a.kin', isKin: true }]}
    emptyDirs={[]} />)
  expect(screen.getByText('main.kin')).toBeInTheDocument()
  const dir = screen.getByText('chapters')
  expect(screen.queryByText('a.kin')).not.toBeInTheDocument() // 默认折叠
  fireEvent.click(dir)
  expect(screen.getByText('a.kin')).toBeInTheDocument()
})

it('点击 .kin 文件触发 onOpenFile（相对路径）', () => {
  const onOpenFile = vi.fn()
  render(<Explorer {...base} onOpenFile={onOpenFile}
    entries={[{ path: 'main.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('main.kin'))
  expect(onOpenFile).toHaveBeenCalledWith('main.kin')
})

it('非 .kin 文件点击不打开', () => {
  const onOpenFile = vi.fn()
  render(<Explorer {...base} onOpenFile={onOpenFile}
    entries={[{ path: 'assets/x.jpg', isKin: false }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('assets'))  // 展开（文件夹默认折叠）
  fireEvent.click(screen.getByText('x.jpg'))
  expect(onOpenFile).not.toHaveBeenCalled()
})

it('头部不再有「添加」按钮', () => {
  render(<Explorer {...base} entries={[{ path: 'main.kin', isKin: true }]} emptyDirs={[]} />)
  expect(screen.queryByRole('button', { name: '添加' })).toBeNull()
})

describe('空白处右键新建', () => {
  it('右键空白处 → 新建文件 → 内联输入提交 onCreateFile', async () => {
    const onCreateFile = vi.fn()
    render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }]}
      emptyDirs={[]}
      onCreateFile={onCreateFile} />)
    fireEvent.contextMenu(screen.getByRole('list'))
    fireEvent.click(screen.getByText('新建文件'))
    const input = screen.getByPlaceholderText('文件名（可含子目录）...')
    await userEvent.type(input, '结局{Enter}')
    expect(onCreateFile).toHaveBeenCalledWith('结局')
  })

  it('右键空白处 → 新建文件夹 → 内联输入提交 onCreateFolder（根级无前缀）', () => {
    const onCreateFolder = vi.fn()
    render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }]}
      emptyDirs={[]}
      onCreateFolder={onCreateFolder} />)
    fireEvent.contextMenu(screen.getByRole('list'))
    fireEvent.click(screen.getByText('新建文件夹'))
    const input = screen.getByPlaceholderText('文件夹名...')
    fireEvent.change(input, { target: { value: '章节' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateFolder).toHaveBeenCalledWith('章节')
  })

  it('空名回车不回调', async () => {
    const onCreateFile = vi.fn()
    render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }]}
      emptyDirs={[]}
      onCreateFile={onCreateFile} />)
    fireEvent.contextMenu(screen.getByRole('list'))
    fireEvent.click(screen.getByText('新建文件'))
    await userEvent.type(screen.getByPlaceholderText('文件名（可含子目录）...'), '{Enter}')
    expect(onCreateFile).not.toHaveBeenCalled()
  })

  it('newFileFocusToken 变化时自动打开输入框', () => {
    const { rerender } = render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }]}
      emptyDirs={[]}
      newFileFocusToken={1} />)
    expect(screen.queryByPlaceholderText('文件名（可含子目录）...')).not.toBeInTheDocument()
    rerender(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }]}
      emptyDirs={[]}
      newFileFocusToken={2} />)
    expect(screen.getByPlaceholderText('文件名（可含子目录）...')).toBeInTheDocument()
  })
})

it('右键文件 → 改名 → 内联编辑提交 onRename', () => {
  const onRename = vi.fn()
  render(<Explorer {...base} onRename={onRename} onDelete={() => {}} onCreateFolder={() => {}} onMove={() => {}}
    entries={[{ path: 'a.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.contextMenu(screen.getByText('a.kin'))
  fireEvent.click(screen.getByText('重命名'))
  const input = screen.getByDisplayValue('a.kin')
  fireEvent.change(input, { target: { value: 'b.kin' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onRename).toHaveBeenCalledWith('a.kin', 'b.kin')
})

it('改名子目录内文件：保留父目录前缀', () => {
  const onRename = vi.fn()
  render(<Explorer {...base} onRename={onRename} onDelete={() => {}} onCreateFolder={() => {}} onMove={() => {}}
    entries={[{ path: 'chapters/intro.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('chapters'))        // 展开
  fireEvent.contextMenu(screen.getByText('intro.kin'))
  fireEvent.click(screen.getByText('重命名'))
  const input = screen.getByDisplayValue('intro.kin')  // 仅文件名
  fireEvent.change(input, { target: { value: 'intro2.kin' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onRename).toHaveBeenCalledWith('chapters/intro.kin', 'chapters/intro2.kin')
})

it('右键文件 → 删除 → onDelete', () => {
  const onDelete = vi.fn()
  render(<Explorer {...base} onRename={() => {}} onDelete={onDelete} onCreateFolder={() => {}} onMove={() => {}}
    entries={[{ path: 'a.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.contextMenu(screen.getByText('a.kin'))
  fireEvent.click(screen.getByText('删除'))
  expect(onDelete).toHaveBeenCalledWith('a.kin')
})

it('右键文件夹 → 新建文件夹 → 内联 → onCreateFolder（含父前缀）', () => {
  const onCreateFolder = vi.fn()
  render(<Explorer {...base} onRename={() => {}} onDelete={() => {}} onCreateFolder={onCreateFolder} onMove={() => {}}
    entries={[{ path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('ch'))            // 展开
  fireEvent.contextMenu(screen.getByText('ch'))
  fireEvent.click(screen.getByText('新建文件夹'))
  const input = screen.getByPlaceholderText('文件夹名...')
  fireEvent.change(input, { target: { value: 'sub' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onCreateFolder).toHaveBeenCalledWith('ch/sub')
})

it('进入新建文件夹后再改名：只剩一个内联输入', () => {
  render(<Explorer {...base}
    onRename={() => {}} onDelete={() => {}} onCreateFolder={() => {}} onMove={() => {}}
    entries={[{ path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('ch'))           // 展开
  fireEvent.contextMenu(screen.getByText('ch'))
  fireEvent.click(screen.getByText('新建文件夹'))
  expect(screen.getByPlaceholderText('文件夹名...')).toBeInTheDocument()
  // 现在对文件改名 → 文件夹输入应消失
  fireEvent.contextMenu(screen.getByText('a.kin'))
  fireEvent.click(screen.getByText('重命名'))
  expect(screen.queryByPlaceholderText('文件夹名...')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('a.kin')).toBeInTheDocument()
})

it('改名输入：IME 组合中的 Enter 不提交，组合结束后的 Enter 才提交', () => {
  const onRename = vi.fn()
  render(<Explorer {...base} onRename={onRename}
    entries={[{ path: '、、.kin', isKin: true }]} emptyDirs={[]} />)
  fireEvent.contextMenu(screen.getByText('、、.kin'))
  fireEvent.click(screen.getByText('重命名'))
  const input = screen.getByDisplayValue('、、.kin')
  // 用户清空，开始用 IME 输入中文，按 Enter 选词（仍在组合态）——不应提交/关闭输入框
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(onRename).not.toHaveBeenCalled()
  expect(screen.getByDisplayValue('')).toBe(input) // 输入框仍在
  // 组合结束，值更新，真正的 Enter 才提交
  fireEvent.change(input, { target: { value: '日记.kin' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onRename).toHaveBeenCalledWith('、、.kin', '日记.kin')
})
