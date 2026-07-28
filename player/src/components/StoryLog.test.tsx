import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
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
})
