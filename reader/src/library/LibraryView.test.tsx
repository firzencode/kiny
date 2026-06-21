import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LibraryItem } from '../types'
import { LibraryView } from './LibraryView'

const items: LibraryItem[] = [
  { id: 'a', dir: '/l/a', name: '雾港之夜', author: '佚名', description: '一个雾夜的故事', cover: 'assets/c.jpg', coverUrl: 'asset://c' },
  { id: 'b', dir: '/l/b', name: '山雀谣', author: '阿苇' },
]

describe('LibraryView', () => {
  it('列出条目；无封面显示首字占位', () => {
    render(<LibraryView items={items} busy={false} onOpen={() => {}} onDelete={() => {}} onImport={() => {}} />)
    expect(screen.getByText('雾港之夜')).toBeInTheDocument()
    expect(screen.getByText('山雀谣')).toBeInTheDocument()
    expect(screen.getByText('山')).toBeInTheDocument() // 生成式占位首字
  })

  it('点条目触发 onOpen', async () => {
    const onOpen = vi.fn()
    render(<LibraryView items={items} busy={false} onOpen={onOpen} onDelete={() => {}} onImport={() => {}} />)
    await userEvent.click(screen.getByText('雾港之夜'))
    expect(onOpen).toHaveBeenCalledWith(items[0])
  })

  it('空书架显示引导与导入按钮', async () => {
    const onImport = vi.fn()
    render(<LibraryView items={[]} busy={false} onOpen={() => {}} onDelete={() => {}} onImport={onImport} />)
    expect(screen.getByText('书架还空着')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /导入故事/ }))
    expect(onImport).toHaveBeenCalled()
  })
})
