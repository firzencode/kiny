import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { advance, initialState, type ResolveAsset } from '@kiny/player'
import { PlayingView } from './PlayingView'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

function makeStory(kin: string): Story {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: 't', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load failed')
  const { program } = analyze(res.files)
  const start = resolveStart(program!, res.entry)!
  return createStory(program!, { start })
}

const KIN = `开场白。
* [去左边] -> 左
=== 左 ===
你往左走。
-> END
`
const KIN_SFX = `开场白。
* [去左边] -> 左
=== 左 ===
@sfx("step.mp3")
你往左走。
-> END
`
const RESOLVE: ResolveAsset = (name) => 'demo/assets/' + name

describe('PlayingView', () => {
  it('点选项触发该步 @sfx：播放一次性音效', async () => {
    const story = makeStory(KIN_SFX)
    const first = advance(story, initialState, RESOLVE).state
    render(<PlayingView story={story} resolveAsset={RESOLVE} first={first} />)
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled() // 首屏无 sfx
    await userEvent.click(screen.getByRole('button', { name: '去左边' }))
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('点选项后叙事流增长并走到结束', async () => {
    const story = makeStory(KIN)
    const first = advance(story, initialState, RESOLVE).state
    render(<PlayingView story={story} resolveAsset={RESOLVE} first={first} />)

    expect(screen.getByText('开场白。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '去左边' }))
    expect(screen.getByText('你往左走。')).toBeInTheDocument()
    expect(screen.getByText('—— 故事结束 ——')).toBeInTheDocument()
  })

  it('StrictMode 包裹下渲染与推进正常、无错误', async () => {
    const story = makeStory(KIN)
    const first = advance(story, initialState, RESOLVE).state
    render(
      <StrictMode>
        <PlayingView story={story} resolveAsset={RESOLVE} first={first} />
      </StrictMode>,
    )
    await userEvent.click(screen.getByRole('button', { name: '去左边' }))
    expect(screen.getByText('你往左走。')).toBeInTheDocument()
    expect(screen.getByText('—— 故事结束 ——')).toBeInTheDocument()
    expect(screen.queryByText(/运行期错误/)).toBeNull()
  })
})
