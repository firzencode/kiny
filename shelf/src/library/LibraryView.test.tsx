import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LibraryView } from './LibraryView'
import type { LibraryItem } from './types'

const items: LibraryItem[] = [
  { id: 'a', name: '甲故事', author: '张三', description: '简介甲', version: '1.0.0' },
  { id: 'b', name: '乙故事', version: '1.0.0' },
]

describe('LibraryView', () => {
  it('空书架显示引导与导入按钮', () => {
    render(<LibraryView items={[]} resumable={new Set()} busy={false} onOpen={() => {}} onDelete={() => {}} onImport={() => {}} />)
    expect(screen.getByText(/书架还空着/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /导入/ })).toBeInTheDocument()
  })

  it('列出书名/作者/简介', () => {
    render(<LibraryView items={items} resumable={new Set()} busy={false} onOpen={() => {}} onDelete={() => {}} onImport={() => {}} />)
    expect(screen.getByText('甲故事')).toBeInTheDocument()
    expect(screen.getByText('张三')).toBeInTheDocument()
    expect(screen.getByText('简介甲')).toBeInTheDocument()
    expect(screen.getByText('乙故事')).toBeInTheDocument()
  })

  it('无续读档 → 只显示「开始」，点击 onOpen(id,"start")', async () => {
    const onOpen = vi.fn()
    render(<LibraryView items={items} resumable={new Set()} busy={false} onOpen={onOpen} onDelete={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /开始/ })[0])
    expect(onOpen).toHaveBeenCalledWith('a', 'start')
  })

  it('有续读档 → 显示「继续」「重新开始」', async () => {
    const onOpen = vi.fn()
    render(<LibraryView items={items} resumable={new Set(['a'])} busy={false} onOpen={onOpen} onDelete={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    expect(onOpen).toHaveBeenCalledWith('a', 'continue')
    await userEvent.click(screen.getByRole('button', { name: /重新开始/ }))
    expect(onOpen).toHaveBeenCalledWith('a', 'start')
  })

  it('删除两步确认后触发 onDelete(id)', async () => {
    const onDelete = vi.fn()
    render(<LibraryView items={items} resumable={new Set()} busy={false} onOpen={() => {}} onDelete={onDelete} onImport={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /删除/ })[0])
    expect(onDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /确定删除/ }))
    expect(onDelete).toHaveBeenCalledWith('a')
  })

  it('点导入触发 onImport', async () => {
    const onImport = vi.fn()
    render(<LibraryView items={items} resumable={new Set()} busy={false} onOpen={() => {}} onDelete={() => {}} onImport={onImport} />)
    await userEvent.click(screen.getByRole('button', { name: /导入/ }))
    expect(onImport).toHaveBeenCalled()
  })

  it('行点击打开：无续读档 → start；有续读档 → continue', async () => {
    const onOpen = vi.fn()
    const { rerender } = render(<LibraryView items={items} resumable={new Set()} busy={false} onOpen={onOpen} onDelete={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getByText('甲故事'))
    expect(onOpen).toHaveBeenLastCalledWith('a', 'start')
    rerender(<LibraryView items={items} resumable={new Set(['a'])} busy={false} onOpen={onOpen} onDelete={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getByText('甲故事'))
    expect(onOpen).toHaveBeenLastCalledWith('a', 'continue')
  })

  it('删除键点击不冒泡成行点击（不触发打开）', async () => {
    const onOpen = vi.fn()
    render(<LibraryView items={items} resumable={new Set()} busy={false} onOpen={onOpen} onDelete={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /删除/ })[0])
    expect(onOpen).not.toHaveBeenCalled()
  })

  describe('临时模式（IndexedDB 不可用）', () => {
    const renderEphemeral = (props: Partial<Parameters<typeof LibraryView>[0]> = {}) =>
      render(
        <LibraryView
          items={[]} resumable={new Set()} busy={false} ephemeral
          onOpen={() => {}} onDelete={() => {}} onImport={() => {}}
          {...props}
        />,
      )

    it('信息条常驻，说明「仅本次可读、刷新后需重新导入」', () => {
      renderEphemeral()
      const bar = screen.getByRole('status')
      expect(bar).toHaveTextContent(/不支持持久书库/)
      expect(bar).toHaveTextContent(/仅本次可读/)
      expect(bar).toHaveTextContent(/刷新后需重新导入/)
    })

    it('渲染一次性导入引导页，不是「书架还空着」（两者承诺不同，不能混用文案）', () => {
      renderEphemeral()
      expect(screen.getByText(/导入一本，当场阅读/)).toBeInTheDocument()
      expect(screen.queryByText(/书架还空着/)).not.toBeInTheDocument()
    })

    it('导入按钮照常可点', async () => {
      const onImport = vi.fn()
      renderEphemeral({ onImport })
      await userEvent.click(screen.getByRole('button', { name: /导入/ }))
      expect(onImport).toHaveBeenCalledTimes(1)
    })

    it('不显示书目计数（临时模式没有「库里有几本」这回事）', () => {
      renderEphemeral()
      expect(screen.queryByText(/个故事/)).not.toBeInTheDocument()
    })

    it('即使传入 items 也不渲染列表（存不住的东西不该显示在架上）', () => {
      renderEphemeral({ items })
      expect(screen.queryByText('甲故事')).not.toBeInTheDocument()
    })

    it('免责声明与署名照常各出现一次', () => {
      renderEphemeral()
      expect(screen.getAllByText(/本站不上传、不存储任何内容/)).toHaveLength(1)
      expect(screen.getByRole('link', { name: /Made with Kiny/ })).toBeInTheDocument()
    })

    it('正常模式（ephemeral 缺省）不出信息条：零回归', () => {
      render(<LibraryView items={[]} resumable={new Set()} busy={false} onOpen={() => {}} onDelete={() => {}} onImport={() => {}} />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByText(/书架还空着/)).toBeInTheDocument()
    })
  })
})
