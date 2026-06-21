import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { SfxController } from './SfxController'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

describe('SfxController', () => {
  it('队列有音效且未静音：逐个播放', () => {
    render(<SfxController sfx={['a.mp3', 'b.mp3']} muted={false} />)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
  })

  it('静音：整体跳过、不播放（错过不补）', () => {
    render(<SfxController sfx={['a.mp3']} muted={true} />)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('队列引用变化（连点同一音效）：重新播放', () => {
    const { rerender } = render(<SfxController sfx={['a.mp3']} muted={false} />)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    rerender(<SfxController sfx={['a.mp3']} muted={false} />) // 新数组同内容
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
  })

  it('空队列：不播放', () => {
    render(<SfxController sfx={[]} muted={false} />)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })
})
