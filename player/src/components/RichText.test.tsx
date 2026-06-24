import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RichText } from './RichText'

describe('RichText', () => {
  it('bold/italic/underline/strike 渲染为 strong/em/u/s', () => {
    const { container } = render(
      <RichText
        spans={[
          { text: '粗', bold: true },
          { text: '斜', italic: true },
          { text: '下', underline: true },
          { text: '删', strike: true },
        ]}
      />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('粗')
    expect(container.querySelector('em')?.textContent).toBe('斜')
    expect(container.querySelector('u')?.textContent).toBe('下')
    expect(container.querySelector('s')?.textContent).toBe('删')
  })

  it('color 落 style.color，size 落 fontSize 的 em', () => {
    const { container } = render(
      <RichText spans={[{ text: 'a', color: 'red', size: 1.5 }]} />,
    )
    const span = container.querySelector('span')!
    expect(span.style.color).toBe('red')
    expect(span.style.fontSize).toBe('1.5em')
  })

  it('break 渲染为 <br>', () => {
    const { container } = render(<RichText spans={[{ text: '上' }, { kind: 'break' }, { text: '下' }]} />)
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.textContent).toBe('上下')
  })

  it('纯文本 span 不包裹任何样式标签', () => {
    const { container } = render(<RichText spans={[{ text: '普通' }]} />)
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('span')).toBeNull()
    expect(container.textContent).toBe('普通')
  })
})
