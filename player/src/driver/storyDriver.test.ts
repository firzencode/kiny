import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles, analyze, resolveStart, createStory, plainText } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { initialState, advance, step, choose, submitInput, submitInputStep } from './storyDriver'
import type { PlayState } from './storyDriver'
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

  it('@clear：清空已显示正文（log=[]），保留 host（bg/bgm 不动）', () => {
    const KIN_CLEAR = `@bg_show("scene.jpg")
@bgm_play("loop.mp3")
旧文一。
旧文二。
@clear()
-> END
`
    const { state } = advance(makeStory(KIN_CLEAR), initialState, RESOLVE)
    // 清屏发生在结束前：log 仅余 end（清空后无新正文），host 背景/BGM 保留
    expect(state.log).toEqual([{ kind: 'end' }])
    expect(state.host.bg).toBe('demo/assets/scene.jpg')
    expect(state.host.bgm).toEqual({ src: 'demo/assets/loop.mp3', playing: true })
    expect(state.ended).toBe(true)
  })

  it('text → @clear → text：最终 log 仅含 clear 之后的正文', () => {
    const KIN_CLEAR2 = `旧文。
@clear()
新文。
-> END
`
    const { state } = advance(makeStory(KIN_CLEAR2), initialState, RESOLVE)
    expect(state.log).toEqual([
      { kind: 'narration', spans: [{ text: '新文。' }] },
      { kind: 'end' },
    ])
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

describe('step（逐行推进）', () => {
  const MULTI = `第一行。
第二行。
第三行。
* [继续] -> END
`
  it('每次 step 只产出一行 narration，choices 暂空', () => {
    const story = makeStory(MULTI)
    const s1 = step(story, initialState, RESOLVE)
    expect(s1.state.log).toEqual([{ kind: 'narration', spans: [{ text: '第一行。' }] }])
    expect(s1.state.choices).toEqual([])
    expect(s1.state.ended).toBe(false)
    const s2 = step(story, s1.state, RESOLVE)
    expect(s2.state.log.map((e) => (e.kind === 'narration' ? plainText(e.spans) : '#'))).toEqual(['第一行。', '第二行。'])
    const s3 = step(story, s2.state, RESOLVE)
    expect(s3.state.log).toHaveLength(3)
    // 再 step → 抵达选项暂停点
    const s4 = step(story, s3.state, RESOLVE)
    expect(s4.state.choices.map((c) => plainText(c.spans))).toEqual(['继续'])
  })

  it('命令与其后一行揭示同步：bg 在承载它的那一 step 才应用', () => {
    const KIN_SYNC = `第一行。
@bg_show("scene.jpg")
第二行。
-> END
`
    const story = makeStory(KIN_SYNC)
    const s1 = step(story, initialState, RESOLVE)
    // 出第一行时 bg 尚未设置（命令在其后）
    expect(s1.state.host.bg).toBeNull()
    const s2 = step(story, s1.state, RESOLVE)
    // 第二行揭示时 bg 已同步应用
    expect(s2.state.host.bg).toBe('demo/assets/scene.jpg')
    expect(s2.state.log[1]).toEqual({ kind: 'narration', spans: [{ text: '第二行。' }] })
  })

  it('@sfx 归瞬时、在承载它的 step 收集', () => {
    const KIN_SFX = `第一行。
@sfx("ding.mp3")
第二行。
-> END
`
    const story = makeStory(KIN_SFX)
    const s1 = step(story, initialState, RESOLVE)
    expect(s1.sfx).toEqual([])
    const s2 = step(story, s1.state, RESOLVE)
    expect(s2.sfx).toEqual(['demo/assets/ding.mp3'])
  })

  it('一致性不变量：连续 step 累积态 == 一次 advance 排空的结果', () => {
    const kins = [MULTI, KIN, `旧。\n@clear()\n新。\n-> END\n`, `只一行。\n-> END\n`]
    for (const kin of kins) {
      const full = advance(makeStory(kin), initialState, RESOLVE)
      // 逐 step 直到抵暂停点（有选项或结束）
      let st: PlayState = initialState
      const story = makeStory(kin)
      const allSfx: string[] = []
      for (let guard = 0; guard < 100; guard++) {
        const r = step(story, st, RESOLVE)
        st = r.state
        allSfx.push(...r.sfx)
        if (st.ended || st.choices.length > 0 || st.error) break
      }
      expect(st.log).toEqual(full.state.log)
      expect(st.host).toEqual(full.state.host)
      expect(st.choices.map((c) => plainText(c.spans))).toEqual(full.state.choices.map((c) => plainText(c.spans)))
      expect(st.ended).toBe(full.state.ended)
      expect(allSfx).toEqual(full.sfx)
    }
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

describe('@input 输入暂停', () => {
  const KIN_INPUT = `~ let player_name = "旅人"
@input(player_name, "请输入你的名字")
你好，{player_name}。
-> END
`
  it('advance 抵输入框：state.input 非空、choices=[]、未结束（不被误判成结束）', () => {
    const { state } = advance(makeStory(KIN_INPUT), initialState, RESOLVE)
    expect(state.input).toEqual({ placeholder: '请输入你的名字' })
    expect(state.choices).toEqual([])
    expect(state.ended).toBe(false)
    expect(state.error).toBeNull()
  })

  it('submitInput 回写变量并排空到下一暂停点（结束）', () => {
    const story = makeStory(KIN_INPUT)
    const atInput = advance(story, initialState, RESOLVE)
    const after = submitInput(story, atInput.state, 'Bob', RESOLVE)
    expect(after.state.input).toBeNull()
    expect(after.state.log).toEqual([
      { kind: 'narration', spans: [{ text: '你好，Bob。' }] },
      { kind: 'end' },
    ])
    expect(after.state.ended).toBe(true)
  })

  it('空提交保留默认值', () => {
    const story = makeStory(KIN_INPUT)
    const atInput = advance(story, initialState, RESOLVE)
    const after = submitInput(story, atInput.state, '   ', RESOLVE)
    expect(after.state.log[0]).toEqual({ kind: 'narration', spans: [{ text: '你好，旅人。' }] })
  })

  it('submitInputStep 提交后只揭示一行（逐行揭示，未直接抵结束）', () => {
    const story = makeStory(KIN_INPUT)
    const atInput = advance(story, initialState, RESOLVE)
    const after = submitInputStep(story, atInput.state, 'Zoe', RESOLVE)
    expect(after.state.input).toBeNull()
    expect(after.state.log).toEqual([{ kind: 'narration', spans: [{ text: '你好，Zoe。' }] }])
    expect(after.state.choices).toEqual([]) // 尚未抵结束（由后续 step 抵达 end）
    expect(after.state.ended).toBe(false)
  })

  it('输入框前的文本先入 log（命令硬边界），再停在输入框', () => {
    const KIN_PRE = `~ let x = "d"
开场白。
@input(x)
{x}
-> END
`
    const { state } = advance(makeStory(KIN_PRE), initialState, RESOLVE)
    expect(state.log).toEqual([{ kind: 'narration', spans: [{ text: '开场白。' }] }])
    expect(state.input).toEqual({ placeholder: null })
  })
})
