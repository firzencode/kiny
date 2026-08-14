import { describe, it, expect, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { StoryLog } from './StoryLog'
import type { LogEntry } from '../driver/storyDriver'

describe('StoryLog', () => {
  it('按序渲染叙事行', () => {
    const entries: LogEntry[] = [
      { kind: 'narration', spans: [{ text: '第一行。' }] },
      { kind: 'narration', spans: [{ text: '第二行。' }] },
    ]
    const { getByText } = render(<StoryLog entries={entries} />)
    expect(getByText('第一行。')).toBeInTheDocument()
    expect(getByText('第二行。')).toBeInTheDocument()
  })
  it('end 标记渲染为「故事结束」', () => {
    const { getByText } = render(<StoryLog entries={[{ kind: 'end' }]} />)
    expect(getByText('—— 故事结束 ——')).toBeInTheDocument()
  })
  it('不传 reveal → 所有行静态呈现（无打字机）', () => {
    const entries: LogEntry[] = [{ kind: 'narration', spans: [{ text: '静态行。' }] }]
    const { container } = render(<StoryLog entries={entries} />)
    expect(container.querySelector('.narration-reveal')).toBeNull()
  })
  it('传 reveal → 仅最新 narration 行走打字机揭示（打字中）', () => {
    const entries: LogEntry[] = [
      { kind: 'narration', spans: [{ text: '旧行。' }] },
      { kind: 'narration', spans: [{ text: '新行。' }] },
    ]
    // speed>0 且未推进 timer → 最新行处于打字中（.narration-reveal），旧行静态。
    const { container, getByText } = render(<StoryLog entries={entries} reveal={{ speed: 100, fade: 50 }} />)
    expect(getByText('旧行。')).toBeInTheDocument() // 旧行静态 RichText
    expect(container.querySelectorAll('.narration-reveal')).toHaveLength(1) // 仅最新行一处 RevealingLine
  })
  it('覆盖整行的作品 class 提升到 .narration 段落（块级样式可用），span 上不重复', () => {
    const entries: LogEntry[] = [
      { kind: 'narration', spans: [{ text: '见字', classes: ['letter'] }, { text: '如晤', classes: ['letter'] }] },
    ]
    const { container } = render(<StoryLog entries={entries} />)
    const p = container.querySelector('p.narration')!
    expect(p.className).toBe('narration kin-letter')
    expect(container.querySelector('span.kin-letter')).toBeNull()
  })
  it('只包片段的 class 留在 span 上，不提升到行', () => {
    const entries: LogEntry[] = [
      { kind: 'narration', spans: [{ text: '他说' }, { text: '三个字', classes: ['whisper'] }] },
    ]
    const { container } = render(<StoryLog entries={entries} />)
    expect(container.querySelector('p.narration')!.className).toBe('narration')
    expect(container.querySelector('span.kin-whisper')).not.toBeNull()
  })
  it('打字揭示中同样应用行级提升（揭示态与定格态 class 归属一致）', () => {
    const entries: LogEntry[] = [
      { kind: 'narration', spans: [{ text: '低语一句', classes: ['whisper'] }] },
    ]
    const { container } = render(<StoryLog entries={entries} reveal={{ speed: 100, fade: 50 }} />)
    expect(container.querySelector('p.narration')!.className).toBe('narration kin-whisper')
  })

  describe('@img 正文插图', () => {
    const IMG: LogEntry = { kind: 'image', src: 'demo/tavern.jpg', alt: '昏暗的酒馆内景', cls: 'wide' }

    it('渲染 <img>，基线 class 恒在、作者类名加 kin- 前缀追加', () => {
      const { container } = render(<StoryLog entries={[IMG]} />)
      const img = container.querySelector('img')!
      expect(img.getAttribute('src')).toBe('demo/tavern.jpg')
      expect(img.getAttribute('alt')).toBe('昏暗的酒馆内景')
      expect(img.className).toBe('kin-illustration kin-wide')
    })

    it('无作者类名时只有基线 class；无 alt 时渲染 alt=""（装饰性图片，屏幕阅读器跳过）', () => {
      const { container } = render(<StoryLog entries={[{ kind: 'image', src: 'a.png' }]} />)
      const img = container.querySelector('img')!
      expect(img.className).toBe('kin-illustration')
      expect(img.getAttribute('alt')).toBe('')
    })

    it('插图不挂 RevealingLine（无揭示过程）', () => {
      const { container } = render(<StoryLog entries={[IMG]} reveal={{ speed: 100, fade: 50 }} />)
      expect(container.querySelector('.narration-reveal')).toBeNull()
    })

    it('最新条目是插图 → 立即上报一次 onLatestRevealed（否则 flow 永久卡死）', () => {
      const onLatestRevealed = vi.fn()
      render(<StoryLog entries={[IMG]} reveal={{ speed: 100, fade: 50, onLatestRevealed }} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
    })

    it('最新条目是叙事行时不误报（上报只属于插图那条路径）', () => {
      const onLatestRevealed = vi.fn()
      render(
        <StoryLog
          entries={[IMG, { kind: 'narration', spans: [{ text: '后一行。' }] }]}
          reveal={{ speed: 100, fade: 50, onLatestRevealed }}
        />,
      )
      expect(onLatestRevealed).not.toHaveBeenCalled() // 由 RevealingLine 揭示完才报
    })

    it('插图在最新位置时，其上方的叙事行不被误当成「最新」而重播打字机', () => {
      const entries: LogEntry[] = [{ kind: 'narration', spans: [{ text: '前一行。' }] }, IMG]
      const { container } = render(<StoryLog entries={entries} reveal={{ speed: 100, fade: 50 }} />)
      expect(container.querySelector('.narration-reveal')).toBeNull()
      expect(container.textContent).toContain('前一行。') // 静态呈现，不是打字中的空白
    })

    it('连续两张插图各上报一次', () => {
      const onLatestRevealed = vi.fn()
      const reveal = { speed: 100, fade: 50, onLatestRevealed }
      const { rerender } = render(<StoryLog entries={[IMG]} reveal={reveal} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
      rerender(<StoryLog entries={[IMG, { kind: 'image', src: 'b.png' }]} reveal={reveal} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(2)
    })

    it('新插图落在同一下标（@clear 后紧跟 @img）照样上报（回归：按下标判重会漏报 → 永久死锁）', () => {
      // @clear 把 log 清空发生在同一次 step 内，故渲染上看到的是 [imgA] → [imgB]，下标都是 0。
      const onLatestRevealed = vi.fn()
      const reveal = { speed: 100, fade: 50, onLatestRevealed }
      const { rerender } = render(<StoryLog entries={[IMG]} reveal={reveal} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
      rerender(<StoryLog entries={[{ kind: 'image', src: 'b.png' }]} reveal={reveal} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(2)
    })

    it('同一条插图重渲染不重复上报（判重按 entry 身份）', () => {
      const onLatestRevealed = vi.fn()
      const reveal = { speed: 100, fade: 50, onLatestRevealed }
      const { rerender } = render(<StoryLog entries={[IMG]} reveal={reveal} />)
      rerender(<StoryLog entries={[IMG]} reveal={reveal} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
    })

    it('无 reveal 绑定时不消耗判重槽（后挂上绑定仍能收到这一条的上报）', () => {
      const onLatestRevealed = vi.fn()
      const { rerender } = render(<StoryLog entries={[IMG]} />)
      rerender(<StoryLog entries={[IMG]} reveal={{ speed: 100, fade: 50, onLatestRevealed }} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
    })

    it('StrictMode 双跑 effect 只上报一次（两次报 = flow 多走一步、下一行打字机被跳过）', () => {
      const onLatestRevealed = vi.fn()
      render(
        <StrictMode>
          <StoryLog entries={[IMG]} reveal={{ speed: 100, fade: 50, onLatestRevealed }} />
        </StrictMode>,
      )
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
    })

    it('图片加载完成后补滚到底（图渲染时高度为 0，不补滚会把正文顶出视野）', () => {
      const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
      const { container } = render(<StoryLog entries={[IMG]} />)
      scroll.mockClear()
      fireEvent.load(container.querySelector('img')!)
      expect(scroll).toHaveBeenCalled()
      scroll.mockRestore()
    })
  })

  describe('@divider 正文分割线', () => {
    const DIV: LogEntry = { kind: 'divider', cls: '幕间' }

    it('渲染 <hr>，基线 class 恒在、作者类名加 kin- 前缀追加', () => {
      const { container } = render(<StoryLog entries={[DIV]} />)
      const hr = container.querySelector('hr')!
      expect(hr.className).toBe('kin-divider kin-幕间')
    })

    it('无作者类名时只有基线 class', () => {
      const { container } = render(<StoryLog entries={[{ kind: 'divider' }]} />)
      expect(container.querySelector('hr')!.className).toBe('kin-divider')
    })

    // 块级分隔必须是 story-log 的**直接子元素**——套进 <p class="narration"> 就是无效 HTML 嵌套
    // （客户端渲染能建出来，但静态预渲染会被 HTML parser 拆开）。这正是本任务不做成行内标签的原因。
    it('是 story-log 的直接子元素，不套在 <p> 里', () => {
      const { container } = render(<StoryLog entries={[DIV]} />)
      const hr = container.querySelector('hr')!
      expect(hr.parentElement!.className).toBe('story-log')
      expect(container.querySelector('p hr')).toBeNull()
    })

    it('分割线不挂 RevealingLine（无揭示过程，与插图同）', () => {
      const { container } = render(<StoryLog entries={[DIV]} reveal={{ speed: 100, fade: 50 }} />)
      expect(container.querySelector('.narration-reveal')).toBeNull()
    })

    // 以下两条锁的是**推进链**而非渲染：只加渲染分支、忘了把 divider 纳入 latestContent 扫描与
    // 立即上报，上面那些渲染用例照样全绿，而 flow 模式会在分割线处永久卡死。见
    // docs/memory/log-entry-must-report-revealed.md。
    it('最新条目是分割线 → 立即上报一次 onLatestRevealed（否则 flow 永久卡死）', () => {
      const onLatestRevealed = vi.fn()
      render(<StoryLog entries={[DIV]} reveal={{ speed: 100, fade: 50, onLatestRevealed }} />)
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
    })

    it('分割线在最新位置时，其上方的叙事行不被误当成「最新」而重播打字机', () => {
      const entries: LogEntry[] = [{ kind: 'narration', spans: [{ text: '第一幕结束。' }] }, DIV]
      const { container } = render(<StoryLog entries={entries} reveal={{ speed: 100, fade: 50 }} />)
      expect(container.querySelector('.narration-reveal')).toBeNull()
      expect(container.textContent).toContain('第一幕结束。') // 静态呈现，不是打字中的空白
    })

    it('StrictMode 双跑 effect 只上报一次（两次报 = flow 多走一步、下一行打字机被跳过）', () => {
      const onLatestRevealed = vi.fn()
      render(
        <StrictMode>
          <StoryLog entries={[DIV]} reveal={{ speed: 100, fade: 50, onLatestRevealed }} />
        </StrictMode>,
      )
      expect(onLatestRevealed).toHaveBeenCalledTimes(1)
    })
  })
})
