import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { StrictMode } from 'react'
import type { RichSpan } from '@kiny/engine'
import { RevealingLine } from './RevealingLine'

// speed=100 cps → 10ms/字，便于 fake timer 精确推进。
const SPEED = 100
// 已揭示文本 = 整个渲染的文本（打字中为 .narration-reveal 拆字，全显后为连贯 RichText）。
const revealed = (c: HTMLElement) => c.textContent ?? ''

describe('RevealingLine（打字机逐字揭示）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('逐字揭示：随时间推进增加可见字数', () => {
    const spans: RichSpan[] = [{ text: '一二三四五' }]
    const { container } = render(<RevealingLine spans={spans} speed={SPEED} fade={50} />)
    expect(revealed(container)).toBe('') // 初始 0 字
    act(() => { vi.advanceTimersByTime(30) })
    expect(revealed(container)).toBe('一二三')
    act(() => { vi.advanceTimersByTime(20) })
    expect(revealed(container)).toBe('一二三四五')
  })

  it('整行揭示完触发 onComplete 一次', () => {
    const onComplete = vi.fn()
    render(<RevealingLine spans={[{ text: 'ab' }]} speed={SPEED} fade={50} onComplete={onComplete} />)
    expect(onComplete).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100) })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('全字出完后淡入拖尾期保持逐字 span，拖尾结束才定格并触发 onComplete（回归：末字淡入被强制截断闪显）', () => {
    const onComplete = vi.fn()
    const spans: RichSpan[] = [{ text: '一二三四五' }]
    const { container } = render(<RevealingLine spans={spans} speed={SPEED} fade={200} onComplete={onComplete} />)
    act(() => { vi.advanceTimersByTime(50) }) // 全字出完（5 字 × 10ms）
    expect(revealed(container)).toBe('一二三四五')
    expect(container.querySelector('.rchar')).not.toBeNull() // 拖尾期：逐字 span 仍在，在飞淡入不被打断
    expect(onComplete).not.toHaveBeenCalled() // 末字还在淡入，整行未完成
    act(() => { vi.advanceTimersByTime(200) }) // 拖尾播完
    expect(container.querySelector('.rchar')).toBeNull() // 已定格为连贯 RichText
    expect(revealed(container)).toBe('一二三四五')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('拖尾期点击跳过 → 立即定格 + onComplete', () => {
    const onComplete = vi.fn()
    const spans: RichSpan[] = [{ text: '一二三四五' }]
    const { container, rerender } = render(
      <RevealingLine spans={spans} speed={SPEED} fade={500} skipToken={0} onComplete={onComplete} />,
    )
    act(() => { vi.advanceTimersByTime(50) }) // 全字出完，进入 500ms 拖尾
    expect(onComplete).not.toHaveBeenCalled()
    act(() => {
      rerender(<RevealingLine spans={spans} speed={SPEED} fade={500} skipToken={1} onComplete={onComplete} />)
    })
    expect(container.querySelector('.rchar')).toBeNull() // 立即定格，不等拖尾
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('skipToken 递增 → 立即整行显示 + onComplete', () => {
    const onComplete = vi.fn()
    const spans: RichSpan[] = [{ text: '一二三四五' }]
    const { container, rerender } = render(
      <RevealingLine spans={spans} speed={SPEED} fade={50} skipToken={0} onComplete={onComplete} />,
    )
    act(() => { vi.advanceTimersByTime(10) })
    expect(revealed(container)).toBe('一')
    act(() => {
      rerender(<RevealingLine spans={spans} speed={SPEED} fade={50} skipToken={1} onComplete={onComplete} />)
    })
    expect(revealed(container)).toBe('一二三四五')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('StrictMode 双跑 effect 不误触 skip（回归：editor 开发态点选项整段瞬显）', () => {
    const onComplete = vi.fn()
    const spans: RichSpan[] = [{ text: '一二三四五' }]
    const { container } = render(
      <StrictMode>
        <RevealingLine spans={spans} speed={SPEED} fade={50} skipToken={0} onComplete={onComplete} />
      </StrictMode>,
    )
    expect(revealed(container)).toBe('') // 双挂载不应把「首跑守卫」当成 skip 触发瞬显
    expect(onComplete).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(30) })
    expect(revealed(container)).toBe('一二三') // 打字机照常逐字推进
  })

  it('speed<=0 → 整行瞬显 + 立即 onComplete', () => {
    const onComplete = vi.fn()
    const { container } = render(<RevealingLine spans={[{ text: '瞬显' }]} speed={0} fade={0} onComplete={onComplete} />)
    expect(revealed(container)).toBe('瞬显')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('prefers-reduced-motion → 整行瞬显（覆盖速度设置）', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, media: '', onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)
    const { container } = render(<RevealingLine spans={[{ text: '一二三' }]} speed={SPEED} fade={50} />)
    expect(revealed(container)).toBe('一二三') // 不等待打字
    spy.mockRestore()
  })

  it('富文本逐字揭示（打字中）保持样式（加粗字带 fontWeight）', () => {
    const spans: RichSpan[] = [{ text: '粗', bold: true }, { text: '常常常' }] // 4 字，确保 10ms 后仍在打字中
    const { container } = render(<RevealingLine spans={spans} speed={SPEED} fade={50} />)
    act(() => { vi.advanceTimersByTime(10) }) // 揭示 1 字（打字中 → 拆字 span）
    const first = container.querySelector('.narration-reveal span') as HTMLElement
    expect(first.textContent).toBe('粗')
    expect(first.style.fontWeight).toBe('700')
  })
})
