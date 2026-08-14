import { describe, it, expect, vi } from 'vitest'
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

/** 取第 n 条 narration 的 spans（断言正文用）。 */
function logSpans(s: PlayState, n: number) {
  const narrations = s.log.filter((e) => e.kind === 'narration')
  const e = narrations[n]
  if (!e || e.kind !== 'narration') throw new Error(`no narration at ${n}`)
  return e.spans
}

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

describe('@panel 固定区域', () => {
  const KIN = '~ let hp = 10\n@panel("left", "HP: {hp}")\n开场。\n~ hp = 3\n次行。\n-> END\n'

  it('panel 事件归约进 host.panels（不产出 log 行）', () => {
    const r = advance(makeStory(KIN), initialState, RESOLVE)
    expect(r.state.host.panels.left).toEqual([{ text: 'HP: 3' }]) // 排空后是最终值
    expect(r.state.log.filter((e) => e.kind === 'narration')).toHaveLength(2) // 面板不占 log
  })

  it('step 逐步推进：面板随变量更新', () => {
    const story = makeStory(KIN)
    let s: PlayState = initialState
    const seen: (string | undefined)[] = []
    for (let g = 0; g < 20 && !s.ended; g++) {
      s = step(story, s, RESOLVE).state
      seen.push(s.host.panels.left ? plainText(s.host.panels.left) : undefined)
    }
    expect(seen).toContain('HP: 10') // 登记后先出 10
    expect(seen[seen.length - 1]).toBe('HP: 3') // 改后是 3
  })

  it('step 累积态 == 一次 advance 排空（面板不破坏不变量）', () => {
    const stepStory = makeStory(KIN)
    let s: PlayState = initialState
    for (let g = 0; g < 20 && !s.ended; g++) s = step(stepStory, s, RESOLVE).state
    const adv = advance(makeStory(KIN), initialState, RESOLVE).state
    expect(s).toEqual(adv)
  })

  it('空串清槽：host.panels 删键', () => {
    const kin = '@panel("right", "有")\n一行。\n@panel("right", "")\n二行。\n-> END\n'
    const r = advance(makeStory(kin), initialState, RESOLVE)
    expect(r.state.host.panels.right).toBeUndefined()
  })
})

describe('@sleep 演出停顿', () => {
  const KIN_SLEEP = `第一行。
@sleep(1500)
第二行。
-> END
`
  it('step 在 sleep 处中断排空并返回 pendingSleep（不产出新行）', () => {
    const story = makeStory(KIN_SLEEP)
    const s1 = step(story, initialState, RESOLVE)
    expect(plainText(logSpans(s1.state, 0))).toBe('第一行。')
    expect(s1.pendingSleep).toBeUndefined()

    const s2 = step(story, s1.state, RESOLVE) // 撞上 sleep：中断，log 不变
    expect(s2.pendingSleep).toBe(1500)
    expect(s2.state.log).toEqual(s1.state.log)
    expect(s2.state.ended).toBe(false)

    const s3 = step(story, s2.state, RESOLVE) // 续步：出下一行
    expect(plainText(logSpans(s3.state, 1))).toBe('第二行。')
    expect(s3.pendingSleep).toBeUndefined()
  })

  it('advance 直接吞掉 sleep：重放 / 读档零等待', () => {
    const r = advance(makeStory(KIN_SLEEP), initialState, RESOLVE)
    expect(r.pendingSleep).toBeUndefined()
    expect(r.state.log.filter((e) => e.kind === 'narration')).toHaveLength(2)
    expect(r.state.ended).toBe(true)
  })

  it('连续 sleep 各自中断一次（等待自然累计）', () => {
    const story = makeStory(`开场。\n@sleep(100)\n@sleep(200)\n结束行。\n-> END\n`)
    const s1 = step(story, initialState, RESOLVE)
    const s2 = step(story, s1.state, RESOLVE)
    expect(s2.pendingSleep).toBe(100)
    const s3 = step(story, s2.state, RESOLVE)
    expect(s3.pendingSleep).toBe(200)
    const s4 = step(story, s3.state, RESOLVE)
    expect(plainText(logSpans(s4.state, 1))).toBe('结束行。')
  })

  it('sleep 不改变归约结果：连续 step 累积态 == 一次 advance 排空', () => {
    const stepStory = makeStory(KIN_SLEEP)
    let s: PlayState = initialState
    for (let guard = 0; guard < 20 && !s.ended; guard++) s = step(stepStory, s, RESOLVE).state
    const adv = advance(makeStory(KIN_SLEEP), initialState, RESOLVE).state
    expect(s).toEqual(adv)
  })

  it('运行期非法时长（负 / 非数 / 缺参）按 0 处理，不崩', () => {
    const story = makeStory(`~ let ms = -5\n开场。\n@sleep(ms)\n尾行。\n-> END\n`)
    const s1 = step(story, initialState, RESOLVE)
    const s2 = step(story, s1.state, RESOLVE)
    expect(s2.pendingSleep).toBe(0)
  })

  it('超大时长夹到 int32 上限（否则 setTimeout 回绕成「立即触发」，作者在预览里看不出写错数量级）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const story = makeStory(`~ let ms = 3e9\n开场。\n@sleep(ms)\n尾行。\n-> END\n`)
    const s1 = step(story, initialState, RESOLVE)
    const s2 = step(story, s1.state, RESOLVE)
    expect(s2.pendingSleep).toBe(2 ** 31 - 1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('advance（重放路径）不为用不上的时长刷 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    advance(makeStory(`~ let ms = -5\n开场。\n@sleep(ms)\n尾行。\n-> END\n`), initialState, RESOLVE)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('选项前的 sleep：等满后选项才浮现（中断时 choices 仍为空）', () => {
    const story = makeStory(`开场。\n@sleep(300)\n* [继续] -> END\n`)
    const s1 = step(story, initialState, RESOLVE)
    const s2 = step(story, s1.state, RESOLVE)
    expect(s2.pendingSleep).toBe(300)
    expect(s2.state.choices).toEqual([])
    const s3 = step(story, s2.state, RESOLVE)
    expect(s3.state.choices).toHaveLength(1)
  })
})

describe('@img 正文插图', () => {
  const KIN_IMG = `她推开门。
@img("assets/tavern.jpg", "昏暗的酒馆内景", "wide")
炉火还没灭。
-> END
`
  /** 取第 n 条 image log 项。 */
  const images = (s: PlayState) => s.log.filter((e) => e.kind === 'image')

  it('产出 image log 项，src 已 resolve、cls 存原始类名（前缀留给渲染层）', () => {
    const r = advance(makeStory(KIN_IMG), initialState, RESOLVE)
    expect(images(r.state)).toEqual([
      { kind: 'image', src: 'demo/assets/assets/tavern.jpg', alt: '昏暗的酒馆内景', cls: 'wide' },
    ])
  })

  it('单参：无 alt、无 cls（装饰性图片，渲染层给 alt=""）', () => {
    const r = advance(makeStory('@img("a.png")\n-> END\n'), initialState, RESOLVE)
    expect(images(r.state)).toEqual([{ kind: 'image', src: 'demo/assets/a.png' }])
  })

  it('插图是一条内容行：step 在此返回（line 模式据此停下等点击）', () => {
    const story = makeStory(KIN_IMG)
    const s1 = step(story, initialState, RESOLVE)
    expect(plainText(logSpans(s1.state, 0))).toBe('她推开门。')
    expect(images(s1.state)).toHaveLength(0) // 尚未到插图

    const s2 = step(story, s1.state, RESOLVE) // 插图独占一步
    expect(images(s2.state)).toHaveLength(1)
    expect(s2.state.log.filter((e) => e.kind === 'narration')).toHaveLength(1) // 没顺带把下一行也出了

    const s3 = step(story, s2.state, RESOLVE)
    expect(plainText(logSpans(s3.state, 1))).toBe('炉火还没灭。')
  })

  it('不变量：连续 step 累积态 == 一次 advance 排空', () => {
    const stepped = (() => {
      const story = makeStory(KIN_IMG)
      let s = initialState
      for (let i = 0; i < 10 && !s.ended; i++) s = step(story, s, RESOLVE).state
      return s
    })()
    const drained = advance(makeStory(KIN_IMG), initialState, RESOLVE).state
    expect(stepped.log).toEqual(drained.log)
  })

  it('@clear 把插图连同正文一并清除（无特判）', () => {
    const r = advance(makeStory('@img("a.png")\n一行。\n@clear()\n之后。\n-> END\n'), initialState, RESOLVE)
    expect(images(r.state)).toHaveLength(0)
  })

  it('路径首尾空白被裁掉再 resolve（否则解析出带空格的 URL 而 404）', () => {
    const r = advance(makeStory('~ let pic = "  a.png  "\n@img(pic)\n-> END\n'), initialState, RESOLVE)
    expect(images(r.state)).toEqual([{ kind: 'image', src: 'demo/assets/a.png' }])
  })

  it('动态路径参数：变量求值后照常产出', () => {
    const src = '~ let pic = "assets/dyn.png"\n@img(pic)\n-> END\n'
    const r = advance(makeStory(src), initialState, RESOLVE)
    expect(images(r.state)).toEqual([{ kind: 'image', src: 'demo/assets/assets/dyn.png' }])
  })

  it('运行期路径非字符串 / 空串 → 整条跳过（不渲染半截）', () => {
    const r1 = advance(makeStory('~ let pic = 42\n@img(pic)\n一行。\n-> END\n'), initialState, RESOLVE)
    expect(images(r1.state)).toHaveLength(0)
    const r2 = advance(makeStory('~ let pic = ""\n@img(pic)\n一行。\n-> END\n'), initialState, RESOLVE)
    expect(images(r2.state)).toHaveLength(0)
  })

  it('运行期跳过的插图不算产出行：step 直接往下出正文，并 warn 给作者', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const story = makeStory('~ let pic = 42\n@img(pic)\n一行。\n-> END\n')
    const s1 = step(story, initialState, RESOLVE)
    expect(plainText(logSpans(s1.state, 0))).toBe('一行。') // 没卡在废插图上
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('advance（重放 / editor 编辑重算）吞掉 warn：同一处笔误不随每次重算刷屏', () => {
    // 与 @sleep 同立场——重放路径不该为作者已经看过的诊断反复刷控制台。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    advance(makeStory('~ let pic = 42\n@img(pic)\n一行。\n-> END\n'), initialState, RESOLVE)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('运行期类名非法 → 忽略类名，图照常渲染（step 路径 warn）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const story = makeStory('~ let c = "two words"\n@img("a.png", "alt", c)\n-> END\n')
    const s1 = step(story, initialState, RESOLVE)
    expect(images(s1.state)).toEqual([{ kind: 'image', src: 'demo/assets/a.png', alt: 'alt' }])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('运行期替代文字非字符串 / 空串 → 按缺省（不落 alt 键）', () => {
    const r = advance(makeStory('~ let a = 42\n@img("a.png", a)\n-> END\n'), initialState, RESOLVE)
    expect(images(r.state)).toEqual([{ kind: 'image', src: 'demo/assets/a.png' }])
  })
})

describe('@divider 正文分割线', () => {
  /** 取全部 divider log 项。 */
  const dividers = (s: PlayState) => s.log.filter((e) => e.kind === 'divider')

  it('无参：产出 divider log 项', () => {
    const r = advance(makeStory('@divider()\n-> END\n'), initialState, RESOLVE)
    expect(dividers(r.state)).toEqual([{ kind: 'divider' }])
  })

  it('带类名：cls 存作者写的原始类名（前缀留给渲染层，与 @img 同规格）', () => {
    const r = advance(makeStory('@divider("幕间")\n-> END\n'), initialState, RESOLVE)
    expect(dividers(r.state)).toEqual([{ kind: 'divider', cls: '幕间' }])
  })

  it('分割线是一条内容行：step 在此返回（line 模式据此停下等点击）', () => {
    const src = '第一幕结束。\n@divider()\n第二幕开始。\n-> END\n'
    const story = makeStory(src)
    const s1 = step(story, initialState, RESOLVE)
    expect(plainText(logSpans(s1.state, 0))).toBe('第一幕结束。')
    expect(dividers(s1.state)).toHaveLength(0) // 尚未到分割线

    const s2 = step(story, s1.state, RESOLVE) // 分割线独占一步
    expect(dividers(s2.state)).toHaveLength(1)
    expect(s2.state.log.filter((e) => e.kind === 'narration')).toHaveLength(1) // 没顺带把下一行也出了

    const s3 = step(story, s2.state, RESOLVE)
    expect(plainText(logSpans(s3.state, 1))).toBe('第二幕开始。')
  })

  // 与 @img 的分歧点：@img 路径非法 → 整条跳过（没有路径就没有图）；@divider 没有必需参数，
  // 一个坏类名不该让分隔本身消失，故只丢类名、照常产出。
  it('运行期类名非法：仍产出分割线，只丢类名（step 路径 warn）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const story = makeStory('~ let c = "two words"\n@divider(c)\n-> END\n')
    const s1 = step(story, initialState, RESOLVE)
    expect(dividers(s1.state)).toEqual([{ kind: 'divider' }])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('advance（重放 / editor 编辑重算）吞掉 warn：同一处笔误不随每次重算刷屏', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    advance(makeStory('~ let c = "two words"\n@divider(c)\n一行。\n-> END\n'), initialState, RESOLVE)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('@clear 把分割线连同正文一并清除（无特判）', () => {
    const r = advance(makeStory('@divider()\n一行。\n@clear()\n之后。\n-> END\n'), initialState, RESOLVE)
    expect(dividers(r.state)).toHaveLength(0)
  })

  it('不变量：连续 step 累积态 == 一次 advance 排空', () => {
    const src = '第一幕结束。\n@divider("幕间")\n第二幕开始。\n-> END\n'
    const stepped = (() => {
      const story = makeStory(src)
      let s = initialState
      for (let i = 0; i < 10 && !s.ended; i++) s = step(story, s, RESOLVE).state
      return s
    })()
    const drained = advance(makeStory(src), initialState, RESOLVE).state
    expect(stepped.log).toEqual(drained.log)
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
