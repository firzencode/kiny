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

  describe('<pause> 句中分段揭示', () => {
    // 「凶手就是…」5 字 + 「你自己！」4 字，边界在第 5 字（下标 5）。
    const PAUSED: RichSpan[] = [{ text: '凶手就是…' }, { text: '你自己！', pauseBefore: true }]

    it('揭示到标记处停住，不再自己往下走', () => {
      const { container } = render(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} />)
      act(() => { vi.advanceTimersByTime(50) }) // 前半段 5 字
      expect(revealed(container)).toBe('凶手就是…')
      act(() => { vi.advanceTimersByTime(500) }) // 继续等：不该自己续显
      expect(revealed(container)).toBe('凶手就是…')
    })

    it('整行未完时不触发 onComplete；续段揭示完整行才触发一次', () => {
      const onComplete = vi.fn()
      const { rerender } = render(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={0} onComplete={onComplete} />)
      act(() => { vi.advanceTimersByTime(500) })
      expect(onComplete).not.toHaveBeenCalled() // 停在标记 ≠ 整行完成
      act(() => { rerender(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={1} onComplete={onComplete} />) })
      act(() => { vi.advanceTimersByTime(500) })
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('点击档位②：停在标记时点击 → 揭示下一段', () => {
      const { container, rerender } = render(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={0} />)
      act(() => { vi.advanceTimersByTime(50) })
      act(() => { rerender(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={1} />) })
      act(() => { vi.advanceTimersByTime(20) }) // 续段逐字推进
      expect(revealed(container)).toBe('凶手就是…你自')
      act(() => { vi.advanceTimersByTime(30) })
      expect(revealed(container)).toBe('凶手就是…你自己！')
    })

    it('点击档位①：段中打字时点击 → 当前段立显但**停在标记**，不穿透', () => {
      const { container, rerender } = render(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={0} />)
      act(() => { vi.advanceTimersByTime(20) }) // 前半段刚出 2 字
      act(() => { rerender(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={1} />) })
      expect(revealed(container)).toBe('凶手就是…') // 当前段立显
      act(() => { vi.advanceTimersByTime(500) })
      expect(revealed(container)).toBe('凶手就是…') // 停在标记，没穿透到后半句
    })

    it('多个标记：逐次点击逐段揭示', () => {
      const three: RichSpan[] = [{ text: '一' }, { text: '二', pauseBefore: true }, { text: '三', pauseBefore: true }]
      const { container, rerender } = render(<RevealingLine spans={three} speed={SPEED} fade={0} skipToken={0} />)
      act(() => { vi.advanceTimersByTime(100) })
      expect(revealed(container)).toBe('一')
      act(() => { rerender(<RevealingLine spans={three} speed={SPEED} fade={0} skipToken={1} />) })
      act(() => { vi.advanceTimersByTime(100) })
      expect(revealed(container)).toBe('一二')
      act(() => { rerender(<RevealingLine spans={three} speed={SPEED} fade={0} skipToken={2} />) })
      act(() => { vi.advanceTimersByTime(100) })
      expect(revealed(container)).toBe('一二三')
    })

    it('行首标记：先等一次点击才出文字', () => {
      const spans: RichSpan[] = [{ text: '迟来的一句。', pauseBefore: true }]
      const { container, rerender } = render(<RevealingLine spans={spans} speed={SPEED} fade={0} skipToken={0} />)
      act(() => { vi.advanceTimersByTime(500) })
      expect(revealed(container)).toBe('')
      act(() => { rerender(<RevealingLine spans={spans} speed={SPEED} fade={0} skipToken={1} />) })
      act(() => { vi.advanceTimersByTime(500) })
      expect(revealed(container)).toBe('迟来的一句。')
    })

    it('reduced-motion（瞬显）下分段停顿仍保留：每段瞬显、标记处仍等点击', () => {
      const { container, rerender } = render(<RevealingLine spans={PAUSED} speed={0} fade={0} skipToken={0} />)
      expect(revealed(container)).toBe('凶手就是…') // 首段瞬显
      act(() => { vi.advanceTimersByTime(500) })
      expect(revealed(container)).toBe('凶手就是…') // 仍停着
      act(() => { rerender(<RevealingLine spans={PAUSED} speed={0} fade={0} skipToken={1} />) })
      expect(revealed(container)).toBe('凶手就是…你自己！') // 点击后下一段瞬显
    })

    it('上报停在标记 / 续段（宿主据此亮灭推进提示三角）', () => {
      const onAwaitingPause = vi.fn()
      const { rerender } = render(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={0} onAwaitingPause={onAwaitingPause} />)
      act(() => { vi.advanceTimersByTime(50) })
      expect(onAwaitingPause).toHaveBeenLastCalledWith(true)
      act(() => { rerender(<RevealingLine spans={PAUSED} speed={SPEED} fade={0} skipToken={1} onAwaitingPause={onAwaitingPause} />) })
      expect(onAwaitingPause).toHaveBeenLastCalledWith(false)
    })

    it('空 spans 的行（glue 拼出的空 text 事件）照常完成，不卡在「等点击」', () => {
      // 回归：空行的段末 limit 也是 0，若与「行首标记」共用同一判断就会落进等待分支，
      // onComplete 永不触发 → flow 模式故事停住。
      const onComplete = vi.fn()
      render(<RevealingLine spans={[]} speed={SPEED} fade={0} onComplete={onComplete} />)
      act(() => { vi.advanceTimersByTime(50) })
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('瞬显模式：整行完成时不补报 awaiting=false（否则盖掉宿主的「整行完等点击」）', () => {
      // 回归：瞬显下「续段」与「整行完成」同批发生，上报 effect 事后补报 false 会把
      // onComplete 刚设上的 line 模式等待态覆盖掉——三角该亮不亮。
      const calls: boolean[] = []
      const onAwaitingPause = (w: boolean) => calls.push(w)
      const onComplete = vi.fn()
      const { rerender } = render(
        <RevealingLine spans={PAUSED} speed={0} fade={0} skipToken={0} onComplete={onComplete} onAwaitingPause={onAwaitingPause} />,
      )
      expect(calls).toEqual([true]) // 首段瞬显后停在标记
      act(() => {
        rerender(<RevealingLine spans={PAUSED} speed={0} fade={0} skipToken={1} onComplete={onComplete} onAwaitingPause={onAwaitingPause} />)
      })
      expect(onComplete).toHaveBeenCalledTimes(1) // 续段后整行完成
      expect(calls).toEqual([true]) // 且**没有**补报 false
    })

    it('<pause/> 自闭合写法等价（与 <br/> 一致）', () => {
      // 解析层等价性由 engine 测试覆盖，这里确认渲染层对同样的 spans 行为一致。
      const { container } = render(<RevealingLine spans={PAUSED} speed={0} fade={0} />)
      expect(revealed(container)).toBe('凶手就是…')
    })

    it('无标记的行：行为与此前完全一致（整行一段、点击即整行立显）', () => {
      const spans: RichSpan[] = [{ text: '一二三四五' }]
      const { container, rerender } = render(<RevealingLine spans={spans} speed={SPEED} fade={0} skipToken={0} />)
      act(() => { vi.advanceTimersByTime(20) })
      act(() => { rerender(<RevealingLine spans={spans} speed={SPEED} fade={0} skipToken={1} />) })
      expect(revealed(container)).toBe('一二三四五')
    })
  })

  it('作品 class 挂在整段外层、不逐字重复（盒模型 / 伪元素只出现一次）', () => {
    const spans: RichSpan[] = [{ text: '他说' }, { text: '三个字', classes: ['whisper'] }]
    const { container } = render(<RevealingLine spans={spans} speed={SPEED} fade={50} />)
    act(() => { vi.advanceTimersByTime(40) }) // 4 字：两字无 class + 两字带 class
    const boxes = container.querySelectorAll('.kin-whisper')
    expect(boxes).toHaveLength(1)
    // 逐字 rchar 在其内层（淡入动画照旧逐字）
    expect(boxes[0]!.querySelectorAll('.rchar').length).toBeGreaterThan(0)
  })
})
