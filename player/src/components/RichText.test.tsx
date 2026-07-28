import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RichText } from './RichText'

describe('RichText', () => {
  it('bold/italic/underline/strike 落内联样式 span（与打字中 RevealingLine 同源，Q2）', () => {
    const bold = render(<RichText spans={[{ text: '粗', bold: true }]} />).container.querySelector('span')!
    expect(bold.style.fontWeight).toBe('700')
    const italic = render(<RichText spans={[{ text: '斜', italic: true }]} />).container.querySelector('span')!
    expect(italic.style.fontStyle).toBe('italic')
    const under = render(<RichText spans={[{ text: '下', underline: true }]} />).container.querySelector('span')!
    expect(under.style.textDecoration).toContain('underline')
    const strike = render(<RichText spans={[{ text: '删', strike: true }]} />).container.querySelector('span')!
    expect(strike.style.textDecoration).toContain('line-through')
    // 不再有语义标签（宿主对 strong/em 的定制不会在「打字→定格」瞬间闪变）。
    expect(bold.tagName).toBe('SPAN')
    expect(render(<RichText spans={[{ text: '粗', bold: true }]} />).container.querySelector('strong')).toBeNull()
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

  it('classes 落 kin- 前缀的 className（作者 css 写 .kin-whisper）', () => {
    const { container } = render(<RichText spans={[{ text: '低语', classes: ['whisper', 'old'] }]} />)
    const span = container.querySelector('span')!
    expect(span.className).toBe('kin-whisper kin-old')
  })

  it('只有 class 无内联样式时仍包 span（否则 class 无处可挂）', () => {
    const { container } = render(<RichText spans={[{ text: 'x', classes: ['a'] }]} />)
    expect(container.querySelector('span.kin-a')).not.toBeNull()
  })

  it('font 落 fontFamily 回退链', () => {
    const { container } = render(<RichText spans={[{ text: '信', font: '楷体' }]} />)
    expect(container.querySelector('span')!.style.fontFamily).toContain('楷体')
  })

  it('纯文本 span 不包裹任何样式标签', () => {
    const { container } = render(<RichText spans={[{ text: '普通' }]} />)
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('span')).toBeNull()
    expect(container.textContent).toBe('普通')
  })
})
