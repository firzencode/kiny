import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles, analyze, resolveStart, createStory, plainText } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { initialState, advance, choose } from './storyDriver'
import type { ResolveAsset } from '../host/commands'

function makeStory(kin: string): Story {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: 't', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load: ' + res.errors.map((e) => e.message).join(';'))
  const { program } = analyze(res.files)
  if (!program) throw new Error('analyze failed')
  const start = resolveStart(program, res.entry)
  if (start === null) throw new Error('no start')
  return createStory(program, { start })
}

const KIN = `@bg_show("a.jpg")
开场白。
* [去左边] -> 左
* [去右边] -> 右
=== 左 ===
你往左走。
-> END
=== 右 ===
你往右走。
-> END
`
const RESOLVE: ResolveAsset = (name) => 'demo/assets/' + name

describe('advance', () => {
  it('推进到选项前：text 进 log、command 改 host、停在 choices；无 @sfx 时 sfx 为空', () => {
    const { state: s, sfx } = advance(makeStory(KIN), initialState, RESOLVE)
    expect(s.log).toEqual([{ kind: 'narration', spans: [{ text: '开场白。' }] }])
    expect(s.host.bg).toBe('demo/assets/a.jpg')
    expect(s.choices.map((c) => plainText(c.spans))).toEqual(['去左边', '去右边'])
    expect(s.ended).toBe(false)
    expect(s.error).toBeNull()
    expect(sfx).toEqual([])
  })

  it('@sfx：URL 进瞬时 sfx、不触动 host；同一推进多个叠加', () => {
    const KIN_SFX = `=== A ===
@sfx("a.mp3")
@bgm_play("loop.mp3")
@sfx("b.mp3")
停。
-> END
`
    const { state, sfx } = advance(makeStory(KIN_SFX), initialState, RESOLVE)
    expect(sfx).toEqual(['demo/assets/a.mp3', 'demo/assets/b.mp3'])
    expect(state.host.bgm).toEqual({ src: 'demo/assets/loop.mp3', playing: true })
  })
})

describe('choose', () => {
  it('选第一个分支后推进到结束、追加 end 标记', () => {
    const story = makeStory(KIN)
    const atChoice = advance(story, initialState, RESOLVE)
    const after = choose(story, atChoice.state, atChoice.state.choices[0]!.index, RESOLVE)
    expect(after.state.log).toEqual([
      { kind: 'narration', spans: [{ text: '开场白。' }] },
      { kind: 'narration', spans: [{ text: '你往左走。' }] },
      { kind: 'end' },
    ])
    expect(after.state.ended).toBe(true)
    expect(after.state.choices).toEqual([])
  })

  it('choose 后该步触发的 @sfx 随返回值带出', () => {
    const KIN2 = `开场。
* [去] -> 去
=== 去 ===
@sfx("step.mp3")
走了。
-> END
`
    const story = makeStory(KIN2)
    const atChoice = advance(story, initialState, RESOLVE)
    const after = choose(story, atChoice.state, atChoice.state.choices[0]!.index, RESOLVE)
    expect(after.sfx).toEqual(['demo/assets/step.mp3'])
  })
})
