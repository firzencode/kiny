import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AudioController } from './AudioController'

let play: ReturnType<typeof vi.fn>
let pause: ReturnType<typeof vi.fn>

beforeEach(() => {
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  // jsdom 不实现 media 元素的 play/pause —— 桩掉
  window.HTMLMediaElement.prototype.play = play
  window.HTMLMediaElement.prototype.pause = pause
})

describe('AudioController', () => {
  it('playing 时渲染 audio 并调用 play()', () => {
    const { container } = render(
      <AudioController bgm={{ src: 'demo/assets/loop.mp3', playing: true }} muted={false} />,
    )
    const audio = container.querySelector('audio')!
    expect(audio.getAttribute('src')).toContain('loop.mp3')
    expect(play).toHaveBeenCalled()
  })
  it('playing=false 时调用 pause()', () => {
    render(<AudioController bgm={{ src: 'demo/assets/loop.mp3', playing: false }} muted={false} />)
    expect(pause).toHaveBeenCalled()
  })
  it('bgm 为 null 时不渲染 audio', () => {
    const { container } = render(<AudioController bgm={null} muted={false} />)
    expect(container.querySelector('audio')).toBeNull()
  })
  it('muted=true 时 audio.muted 同步为 true 且调用 pause()', () => {
    const { container } = render(
      <AudioController bgm={{ src: 'demo/assets/loop.mp3', playing: true }} muted={true} />,
    )
    const audio = container.querySelector('audio')!
    expect(audio.muted).toBe(true)
    expect(pause).toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })
})
