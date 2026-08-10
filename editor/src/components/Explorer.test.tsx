import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Explorer } from './Explorer'

const base = {
  projectName: 'P', dirtyMap: {}, activeFile: null, entry: 'main.kin',
  onOpenFile: () => {}, onCreateFile: () => {},
  onRename: () => {}, onDelete: () => {}, onCreateFolder: () => {}, onMove: () => {},
  onImportAssets: () => {},
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

it('没有查看器的二进制（字体）点击不打开，且灰显', () => {
  const onOpenFile = vi.fn()
  render(<Explorer {...base} onOpenFile={onOpenFile}
    entries={[{ path: 'fonts/楷体.woff2', isKin: false }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('fonts'))  // 展开（文件夹默认折叠）
  const row = screen.getByText('楷体.woff2').closest('li')!
  fireEvent.click(screen.getByText('楷体.woff2'))
  expect(onOpenFile).not.toHaveBeenCalled()
  expect(row.className).toContain('frow-other')
})

it('图片 / 音频可点开（媒体预览），且不灰显', () => {
  const onOpenFile = vi.fn()
  render(<Explorer {...base} onOpenFile={onOpenFile}
    entries={[{ path: 'assets/x.jpg', isKin: false }, { path: 'assets/雨.mp3', isKin: false }]} emptyDirs={[]} />)
  fireEvent.click(screen.getByText('assets'))  // 展开（文件夹默认折叠）
  fireEvent.click(screen.getByText('x.jpg'))
  expect(onOpenFile).toHaveBeenCalledWith('assets/x.jpg')
  fireEvent.click(screen.getByText('雨.mp3'))
  expect(onOpenFile).toHaveBeenCalledWith('assets/雨.mp3')
  expect(screen.getByText('x.jpg').closest('li')!.className).not.toContain('frow-other')
  expect(screen.getByText('雨.mp3').closest('li')!.className).not.toContain('frow-other')
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

describe('取消拖拽、改点击式「移动到…」', () => {
  const picker = () => document.querySelector('.move-picker') as HTMLElement | null
  const openMove = (rowText: string) => {
    fireEvent.contextMenu(screen.getByText(rowText))
    fireEvent.click(screen.getByText('移动到…'))
  }

  it('文件行 / 目录行 / 根列表均不再带 draggable 与拖拽事件', () => {
    render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }, { path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
    fireEvent.click(screen.getByText('ch')) // 展开出文件行
    // 全树不应存在任何 draggable 元素
    expect(document.querySelector('[draggable]')).toBeNull()
  })

  it('文件的「移动到…」列合法目标：含根目录与其它文件夹、排除当前父目录（原位）', () => {
    render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }, { path: 'ch/a.kin', isKin: true }]}
      emptyDirs={['art']} />)
    fireEvent.click(screen.getByText('ch')) // 展开以能右键 a.kin
    openMove('a.kin')
    const p = within(picker()!)
    expect(p.getByText('根目录')).toBeInTheDocument()
    expect(p.getByText('art')).toBeInTheDocument()
    expect(p.queryByText('ch')).toBeNull() // 当前父目录=原位，排除
  })

  it('目录的「移动到…」候选排除自身及其子孙目录', () => {
    render(<Explorer {...base}
      entries={[{ path: 'ch/sub/b.kin', isKin: true }, { path: 'other/c.kin', isKin: true }]}
      emptyDirs={[]} />)
    openMove('ch')
    const p = within(picker()!)
    expect(p.getByText('other')).toBeInTheDocument()
    expect(p.queryByText('ch')).toBeNull()   // 自身（且在根 → 也是原位）
    expect(p.queryByText('sub')).toBeNull()  // 子孙
    expect(p.queryByText('根目录')).toBeNull() // ch 本在根 → 原位
  })

  it('点目标行 → onMove(from, dir)', () => {
    const onMove = vi.fn()
    render(<Explorer {...base} onMove={onMove}
      entries={[{ path: 'main.kin', isKin: true }, { path: 'ch/a.kin', isKin: true }]}
      emptyDirs={['art']} />)
    fireEvent.click(screen.getByText('ch'))
    openMove('a.kin')
    fireEvent.click(within(picker()!).getByText('art'))
    expect(onMove).toHaveBeenCalledWith('ch/a.kin', 'art')
    expect(picker()).toBeNull() // 选后关闭
  })

  it('移到「根目录」→ onMove(from, "")', () => {
    const onMove = vi.fn()
    render(<Explorer {...base} onMove={onMove}
      entries={[{ path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
    fireEvent.click(screen.getByText('ch'))
    openMove('a.kin')
    fireEvent.click(within(picker()!).getByText('根目录'))
    expect(onMove).toHaveBeenCalledWith('ch/a.kin', '')
  })

  it('无合法目标：渲染禁用占位、点击不触发 onMove', () => {
    const onMove = vi.fn()
    render(<Explorer {...base} onMove={onMove}
      entries={[{ path: 'main.kin', isKin: true }]} emptyDirs={[]} />)
    openMove('main.kin') // 根级唯一文件、无文件夹 → 无合法目标
    const p = within(picker()!)
    const placeholder = p.getByText('无可移动到的位置')
    expect(placeholder).toBeInTheDocument()
    fireEvent.click(placeholder)
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('右键导入资源', () => {
  it('「导入资源…」在 file / dir / root 三种 kind 都出现', () => {
    const { rerender } = render(<Explorer {...base}
      entries={[{ path: 'main.kin', isKin: true }, { path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
    // root（空白右键）
    fireEvent.contextMenu(screen.getByRole('list'))
    expect(screen.getByText('导入资源…')).toBeInTheDocument()
    // file
    fireEvent.contextMenu(screen.getByText('main.kin'))
    expect(screen.getByText('导入资源…')).toBeInTheDocument()
    // dir
    rerender(<Explorer {...base} entries={[{ path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
    fireEvent.contextMenu(screen.getByText('ch'))
    expect(screen.getByText('导入资源…')).toBeInTheDocument()
  })

  it('右键文件夹 → 导入资源 → onImportAssets(该目录)', () => {
    const onImportAssets = vi.fn()
    render(<Explorer {...base} onImportAssets={onImportAssets}
      entries={[{ path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
    fireEvent.contextMenu(screen.getByText('ch'))
    fireEvent.click(screen.getByText('导入资源…'))
    expect(onImportAssets).toHaveBeenCalledWith('ch')
  })

  it('右键子目录内文件 → 导入资源 → onImportAssets(其父目录)', () => {
    const onImportAssets = vi.fn()
    render(<Explorer {...base} onImportAssets={onImportAssets}
      entries={[{ path: 'ch/a.kin', isKin: true }]} emptyDirs={[]} />)
    fireEvent.click(screen.getByText('ch')) // 展开
    fireEvent.contextMenu(screen.getByText('a.kin'))
    fireEvent.click(screen.getByText('导入资源…'))
    expect(onImportAssets).toHaveBeenCalledWith('ch')
  })

  it('右键空白 → 导入资源 → onImportAssets(根 "")', () => {
    const onImportAssets = vi.fn()
    render(<Explorer {...base} onImportAssets={onImportAssets}
      entries={[{ path: 'main.kin', isKin: true }]} emptyDirs={[]} />)
    fireEvent.contextMenu(screen.getByRole('list'))
    fireEvent.click(screen.getByText('导入资源…'))
    expect(onImportAssets).toHaveBeenCalledWith('')
  })
})
