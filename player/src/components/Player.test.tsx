import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Player } from './Player'
import type { PlayState } from '../driver/storyDriver'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

const atChoice: PlayState = {
  log: [{ kind: 'narration', spans: [{ text: '开场白。' }] }],
  host: { bg: null, bgm: null },
  choices: [{ spans: [{ text: '去左边' }], index: 0 }, { spans: [{ text: '去右边' }], index: 1 }],
  ended: false,
  error: null,
}

describe('Player（受控）', () => {
  it('渲染叙事流与选项；点选项以位置回调 onChoose', async () => {
    const onChoose = vi.fn()
    render(<Player state={atChoice} onChoose={onChoose} />)
    expect(screen.getByText('开场白。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '去右边' }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('结束态显示结束标记、不渲染选项', () => {
    const ended: PlayState = {
      log: [{ kind: 'narration', spans: [{ text: '你往左走。' }] }, { kind: 'end' }],
      host: { bg: null, bgm: null }, choices: [], ended: true, error: null,
    }
    const onChoose = vi.fn()
    render(<Player state={ended} onChoose={onChoose} />)
    expect(screen.getByText('—— 故事结束 ——')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /去/ })).toBeNull()
  })

  it('运行期错误时显示错误行、不渲染选项', () => {
    const errored: PlayState = {
      log: [], host: { bg: null, bgm: null }, choices: [],
      ended: false, error: { message: '炸了', file: 'main.kin', line: 3 },
    }
    render(<Player state={errored} onChoose={vi.fn()} />)
    expect(screen.getByText(/运行期错误/)).toBeInTheDocument()
    expect(screen.getByText(/炸了/)).toBeInTheDocument()
  })
})
