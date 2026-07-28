import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FixedPanels, AfterPanel } from './Panels'

describe('FixedPanels / AfterPanel', () => {
  it('渲染已登记的槽，空槽不出容器', () => {
    const { container } = render(<FixedPanels panels={{ left: [{ text: 'HP: 10' }] }} />)
    const left = container.querySelector('.panel-left')!
    expect(left.textContent).toBe('HP: 10')
    expect(container.querySelector('.panel-right')).toBeNull() // 未登记
    expect(container.querySelector('.panel-bottom')).toBeNull()
  })

  it('左 / 右侧栏各自独立渲染', () => {
    const { container } = render(<FixedPanels panels={{ left: [{ text: '左' }], right: [{ text: '右' }] }} />)
    expect(container.querySelector('.panel-left')!.textContent).toBe('左')
    expect(container.querySelector('.panel-right')!.textContent).toBe('右')
  })

  it('富文本内容经 RichText 渲染', () => {
    const { container } = render(
      <FixedPanels panels={{ left: [{ text: '状态', bold: true }, { kind: 'break' }, { text: 'HP: 5' }] }} />,
    )
    expect(container.querySelector('.panel-left span')!.textContent).toBe('状态')
    expect(container.querySelector('.panel-left br')).not.toBeNull()
  })

  it('四槽都空 → 什么都不渲染', () => {
    const { container } = render(<FixedPanels panels={{}} />)
    expect(container.querySelector('.panel')).toBeNull()
  })

  it('面板挂 aria-live=polite（内容变化播报）', () => {
    const { container } = render(<FixedPanels panels={{ bottom: [{ text: '第 1 章' }] }} />)
    expect(container.querySelector('.panel-bottom')!.getAttribute('aria-live')).toBe('polite')
  })

  it('AfterPanel 只渲染 after 槽', () => {
    const { container } = render(<AfterPanel panels={{ left: [{ text: '左' }], after: [{ text: '正文后' }] }} />)
    expect(container.querySelector('.panel-after')!.textContent).toBe('正文后')
    expect(container.querySelector('.panel-left')).toBeNull() // AfterPanel 不管侧栏
  })

  it('AfterPanel 无 after 槽 → 空', () => {
    const { container } = render(<AfterPanel panels={{ left: [{ text: '左' }] }} />)
    expect(container.firstChild).toBeNull()
  })
})
