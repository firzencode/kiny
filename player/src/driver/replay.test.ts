import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles, analyze, resolveStart, plainText } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import { replay, replayToStory, type InteractionStep } from './replay'
import { chooseStep } from './storyDriver'
import type { ResolveAsset } from '../host/commands'

/** 简写：位置序列 → choice 交互步序列（旧 number[] 用例的等价写法）。 */
const choices = (...ps: number[]): InteractionStep[] => ps.map((pos) => ({ kind: 'choice', pos }))

const RESOLVE: ResolveAsset = (name) => 'a/' + name

function build(kin: string): { program: ValidatedProgram; start: string } {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: 't', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load: ' + res.errors.map((e) => e.message).join(';'))
  const { program } = analyze(res.files)
  if (!program) throw new Error('analyze failed')
  const start = resolveStart(program, res.entry)
  if (start === null) throw new Error('no start')
  return { program, start }
}

// 两个分支各自再分两支：可走 [0,0] / [0,1] / [1] 等多种位置序列。
const TREE = `开场。
* [A] -> a
* [B] -> b
=== a ===
进了 A。
* [A1] -> end
* [A2] -> end
=== b ===
进了 B。
-> END
=== end ===
收束。
-> END
`

// 含 random()+shuffle() 的确定性故事（取自 engine 黄金 trace），用于确定性断言。
const RANDOM = [
  '~ let dice = random(1, 6)',
  '~ let beats = 0',
  '=== 雾号 ===',
  '今夜骰子 {dice} 点。',
  '-> 鸣笛',
  '=== 鸣笛 ===',
  '雾里一声：{ shuffle("近处", "远处", "更远处") }。',
  '~ beats++',
  '+ {beats < 3} [再听一声] -> 鸣笛',
  '* [够了，走] -> 散场',
  '=== 散场 ===',
  '雾渐渐散了。',
  '-> END',
].join('\n')

// analyze 通过、但运行时插值 o.x（o=null）抛 RuntimeError（取自 engine interp.test）。
// 错误埋在 [继续] 选项之后的节点里：advance 到首个暂停点不出错，choose 后才触发。
const BOOM = [
  '~ let o = null',
  '=== 起 ===',
  '安全。',
  '* [继续] -> 雷',
  '=== 雷 ===',
  '值{o.x}', // 运行时对 null 取属性 → RuntimeError
  '-> END',
].join('\n')

describe('replay', () => {
  it('有效路径：完整应用 choiceSeq，保位恢复到对应叶子', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, choices(0, 1), RESOLVE) // A → A2 → end
    expect(r.appliedCount).toBe(2)
    expect(r.state.ended).toBe(true)
    expect(r.state.error).toBeNull()
    const prose = r.state.log.filter((e) => e.kind === 'narration').map((e: any) => plainText(e.spans))
    expect(prose).toContain('进了 A。')
    expect(prose).toContain('收束。')
  })

  it('位置越界：停在一致前缀（appliedCount = 前缀长度）', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, choices(0, 5), RESOLVE) // 第二步位置 5 越界
    expect(r.appliedCount).toBe(1)
    expect(r.state.ended).toBe(false)
    expect(r.state.choices.map((c) => plainText(c.spans))).toEqual(['A1', 'A2']) // 停在 A 节点的选项前
  })

  it('故事提前结束：剩余 choiceSeq 被安全忽略', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, choices(1, 0, 0), RESOLVE) // B 直接 -> END，后两步无处可用
    expect(r.appliedCount).toBe(1)
    expect(r.state.ended).toBe(true)
    expect(r.state.error).toBeNull()
  })

  it('确定性：同 seed + 同 choiceSeq 多次重建得逐字一致 PlayState（含 random/shuffle）', () => {
    const { program } = build(RANDOM)
    // RANDOM 的 ~let 是前导块，resolveStart 会落到立即结束的 opening knot；
    // 故此处显式以 '雾号' 为入口，忠实复刻 engine 黄金 trace（seed 5 → dice 5）。
    const a = replay(program, '雾号', 5, choices(0, 0, 0), RESOLVE)
    const b = replay(program, '雾号', 5, choices(0, 0, 0), RESOLVE)
    expect(a).toEqual(b)
    const prose = a.state.log.filter((e) => e.kind === 'narration').map((e: any) => plainText(e.spans))
    expect(prose[0]).toBe('今夜骰子 5 点。') // seed 5 下 random(1,6)=5（engine 黄金 trace）
  })

  it('空 choiceSeq：仅 advance 到首个暂停点', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, [], RESOLVE)
    expect(r.appliedCount).toBe(0)
    expect(r.state.choices.map((c) => plainText(c.spans))).toEqual(['A', 'B'])
  })

  it('运行时错误：重放安全停在出错点，state.error 置位、不抛', () => {
    const { program } = build(BOOM)
    // ~let o 前导块落在立即结束的 opening knot（同 RANDOM），故显式以 '起' 为入口。
    // [继续] 这步本身不出错；choose 后 advance 进「雷」节点，插值 o.x 才抛 RuntimeError。
    const r = replay(program, '起', 1, choices(0), RESOLVE)
    expect(r.state.error).not.toBeNull()
    expect(r.state.ended).toBe(false)
    expect(r.appliedCount).toBe(1) // [继续] 这步已消费，错误发生在其后的 advance 阶段
  })

  it('出错步计入 appliedCount、其后步不计（T069 A7）：slice(0,appliedCount) 保留触发出错的交互', () => {
    const { program } = build(BOOM)
    // 出错发生在第 1 步（choices(0)）之后的 advance；再给一个多余步 → 因 state.error 提前 break、不计入。
    const r = replay(program, '起', 1, choices(0, 0), RESOLVE)
    expect(r.state.error).not.toBeNull()
    expect(r.appliedCount).toBe(1) // 触发出错的第 1 步计入、其后步不计入
    expect(choices(0, 0).slice(0, r.appliedCount)).toEqual(choices(0)) // 持久化 seq 保留出错交互
  })

  it('sfx：只回传最后一步、丢弃历史步（重放不重播过往音效）', () => {
    const SFX_TREE = `开场。
* [A] -> a
=== a ===
@sfx("a.mp3")
进 A。
* [A1] -> end
=== end ===
@sfx("end.mp3")
收束。
-> END
`
    const { program, start } = build(SFX_TREE)
    const r = replay(program, start, 1, choices(0, 0), RESOLVE) // A → A1 → end
    expect(r.appliedCount).toBe(2)
    expect(r.sfx).toEqual(['a/end.mp3']) // 仅末步，不含中间步的 a.mp3
  })

  it('sfx：空 choiceSeq 时为初始 advance 的 sfx（此例无 → 空）', () => {
    const { program, start } = build(TREE)
    expect(replay(program, start, 1, [], RESOLVE).sfx).toEqual([])
  })

  it('replayToStory：与 replay 结果一致，且额外带上可继续推进的活 story', () => {
    const { program, start } = build(TREE)
    const viaReplay = replay(program, start, 1, choices(0), RESOLVE) // A
    const viaStory = replayToStory(program, start, 1, choices(0), RESOLVE)
    expect(viaStory.state).toEqual(viaReplay.state)
    expect(viaStory.appliedCount).toBe(viaReplay.appliedCount)
    expect(viaStory.sfx).toEqual(viaReplay.sfx)
    // 用返回的活 story 继续选 A1，能正常推进（证明不是重放完就丢弃的死对象）
    const idx = viaStory.state.choices[0]!.index
    const r = chooseStep(viaStory.story, viaStory.state, idx, RESOLVE)
    const prose = r.state.log.filter((e) => e.kind === 'narration').map((e: any) => plainText(e.spans))
    expect(prose).toContain('进了 A。')
  })
})

// 先选路、再输入名字、再继续：交互序列含 choice 与 input 两类步。
const INPUT_TREE = `~ let name = "旅人"
开场，选条路。
* [海边栈道] -> shore
* [林间小道] -> forest
=== shore ===
海边。
-> END
=== forest ===
林间。
@input(name, "请输入你的名字")
你好，{name}。
* [前进] -> deep
* [折返] -> deep
=== deep ===
深处。
-> END
`

// 无 @input 版（模拟作者删了 @input）：forest 直接给选项、不请求输入。
const INPUT_TREE_NO_INPUT = `~ let name = "旅人"
开场，选条路。
* [海边栈道] -> shore
* [林间小道] -> forest
=== shore ===
海边。
-> END
=== forest ===
林间。
* [前进] -> deep
* [折返] -> deep
=== deep ===
深处。
-> END
`

describe('replay · 输入步（交互序列泛化）', () => {
  it('choice + input + choice 完整应用，保位恢复且输入文本插值生效', () => {
    const { program, start } = build(INPUT_TREE)
    const r = replay(program, start, 1, [
      { kind: 'choice', pos: 1 }, // 林间小道
      { kind: 'input', text: '旅人' },
      { kind: 'choice', pos: 0 }, // 前进
    ], RESOLVE)
    expect(r.appliedCount).toBe(3)
    expect(r.state.ended).toBe(true)
    expect(r.state.error).toBeNull()
    const prose = r.state.log.filter((e) => e.kind === 'narration').map((e: any) => plainText(e.spans))
    expect(prose).toContain('你好，旅人。')
    expect(prose).toContain('深处。')
  })

  it('input 步停在输入暂停点：state.input 非空、appliedCount 计入前一 choice', () => {
    const { program, start } = build(INPUT_TREE)
    const r = replay(program, start, 1, [{ kind: 'choice', pos: 1 }], RESOLVE) // 停在 @input
    expect(r.appliedCount).toBe(1)
    expect(r.state.input).toEqual({ placeholder: '请输入你的名字' })
    expect(r.state.choices).toEqual([])
    expect(r.state.ended).toBe(false)
  })

  it('input 步撞非输入暂停点（作者删了 @input）：优雅截断、不进 error 态', () => {
    const { program, start } = build(INPUT_TREE_NO_INPUT)
    const r = replay(program, start, 1, [
      { kind: 'choice', pos: 1 }, // 林间小道 → 停在 [前进]/[折返] 选项（非输入暂停点）
      { kind: 'input', text: '旅人' }, // 撞选项暂停点 → break
      { kind: 'choice', pos: 0 },
    ], RESOLVE)
    expect(r.appliedCount).toBe(1) // 只应用了首个 choice
    expect(r.state.error).toBeNull() // 绝不硬调 submitInput 撞引擎 RuntimeError
    expect(r.state.input).toBeNull()
    expect(r.state.choices.map((c) => plainText(c.spans))).toEqual(['前进', '折返'])
  })

  it('确定性：同 seed + 同交互序列多次重建逐字一致', () => {
    const { program, start } = build(INPUT_TREE)
    const seq: InteractionStep[] = [
      { kind: 'choice', pos: 1 },
      { kind: 'input', text: '晓' },
      { kind: 'choice', pos: 1 },
    ]
    const a = replay(program, start, 3, seq, RESOLVE)
    const b = replay(program, start, 3, seq, RESOLVE)
    expect(a).toEqual(b)
    const prose = a.state.log.filter((e) => e.kind === 'narration').map((e: any) => plainText(e.spans))
    expect(prose).toContain('你好，晓。')
  })
})
