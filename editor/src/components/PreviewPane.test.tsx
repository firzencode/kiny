import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewPane } from './PreviewPane'
import type { PlayState } from '@kiny/player'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

const atChoice: PlayState = {
  log: [{ kind: 'narration', text: '开场。' }],
  host: { bg: null, bgm: null },
  choices: [{ text: 'A', index: 0 }, { text: 'B', index: 1 }],
  ended: false, error: null,
}

describe('PreviewPane', () => {
  it('渲染 Player；点选项以位置回调 onChoose', async () => {
    const onChoose = vi.fn()
    render(<PreviewPane play={atChoice} stale={false} onChoose={onChoose} onRestart={vi.fn()} />)
    expect(screen.getByText('开场。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('重开按钮回调 onRestart', async () => {
    const onRestart = vi.fn()
    render(<PreviewPane play={atChoice} stale={false} onChoose={vi.fn()} onRestart={onRestart} />)
    await userEvent.click(screen.getByRole('button', { name: /重开预览/ }))
    expect(onRestart).toHaveBeenCalled()
  })

  it('stale=true 显示「基于上一个有效版本」角标', () => {
    render(<PreviewPane play={atChoice} stale onChoose={vi.fn()} onRestart={vi.fn()} />)
    expect(screen.getByText(/基于上一个有效版本/)).toBeInTheDocument()
  })

  it('play.error 非空显示运行时错误横幅', () => {
    const errored: PlayState = { ...atChoice, choices: [], error: { message: '炸了', file: 'main.kin', line: 2 } }
    render(<PreviewPane play={errored} stale={false} onChoose={vi.fn()} onRestart={vi.fn()} />)
    expect(screen.getByText(/运行时错误/)).toBeInTheDocument()
    expect(screen.getByText(/炸了/)).toBeInTheDocument()
  })

  it('play 为 null（尚无有效版本）显示占位', () => {
    render(<PreviewPane play={null} stale={false} onChoose={vi.fn()} onRestart={vi.fn()} />)
    expect(screen.getByText(/暂无预览/)).toBeInTheDocument()
  })

  it('sfx 队列非空：透传到 Player 播放一次性音效', () => {
    render(<PreviewPane play={atChoice} stale={false} sfx={['mem://s.mp3']} onChoose={vi.fn()} onRestart={vi.fn()} />)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })
})
