import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { advance, initialState } from '@kiny/player'
import type { ResolveAsset } from '@kiny/player'
import { assembleStory } from './assembleStory'
import { ReadingView } from './ReadingView'

const MANIFEST = JSON.stringify({ name: 'T', version: '1', engine: '0.1.0', entry: 'main.kin' })
const KIN = '=== 开场 ===\n你站在门口。\n* [推门进去] -> 里屋\n* [转身离开] -> END\n=== 里屋 ===\n屋里很暖。\n-> END\n'
const resolve: ResolveAsset = (n) => n

function build() {
  const out = assembleStory(MANIFEST, new Map([['main.kin', KIN]]), 1)
  if (!out.ok) throw new Error(out.message)
  return out.story
}

describe('ReadingView', () => {
  it('渲染叙事与选项，点选项推进故事', async () => {
    const story = build()
    const first = advance(story, initialState, resolve).state
    render(<ReadingView story={story} resolveAsset={resolve} first={first} title="T" onBack={() => {}} />)
    expect(screen.getByText('你站在门口。')).toBeInTheDocument()
    await userEvent.click(screen.getByText('推门进去'))
    expect(screen.getByText('屋里很暖。')).toBeInTheDocument()
  })

  it('点「返回书架」触发 onBack', async () => {
    const story = build()
    const first = advance(story, initialState, resolve).state
    const onBack = vi.fn()
    render(<ReadingView story={story} resolveAsset={resolve} first={first} title="T" onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: /书架/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
