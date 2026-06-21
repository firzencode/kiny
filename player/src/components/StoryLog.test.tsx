import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StoryLog } from './StoryLog'
import type { LogEntry } from '../driver/storyDriver'

describe('StoryLog', () => {
  it('按序渲染叙事行', () => {
    const entries: LogEntry[] = [
      { kind: 'narration', text: '第一行。' },
      { kind: 'narration', text: '第二行。' },
    ]
    const { getByText } = render(<StoryLog entries={entries} />)
    expect(getByText('第一行。')).toBeInTheDocument()
    expect(getByText('第二行。')).toBeInTheDocument()
  })
  it('end 标记渲染为「故事结束」', () => {
    const { getByText } = render(<StoryLog entries={[{ kind: 'end' }]} />)
    expect(getByText('—— 故事结束 ——')).toBeInTheDocument()
  })
})
