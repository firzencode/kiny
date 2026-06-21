import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Choices } from './Choices'
import type { ChoiceView } from '@kiny/engine'

const items: ChoiceView[] = [
  { text: '走向客栈', index: 0 },
  { text: '沿码头继续走', index: 1 },
]

describe('Choices', () => {
  it('渲染每个选项为按钮', () => {
    render(<Choices items={items} onChoose={() => {}} />)
    expect(screen.getByRole('button', { name: '走向客栈' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '沿码头继续走' })).toBeInTheDocument()
  })
  it('点击回调对应 index', async () => {
    const onChoose = vi.fn()
    render(<Choices items={items} onChoose={onChoose} />)
    await userEvent.click(screen.getByRole('button', { name: '沿码头继续走' }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })
})
