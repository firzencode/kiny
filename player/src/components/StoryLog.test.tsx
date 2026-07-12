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
})
