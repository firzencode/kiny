import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles, analyze, resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import { replay } from './replay'
import type { ResolveAsset } from '../host/commands'

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
    const r = replay(program, start, 1, [0, 1], RESOLVE) // A → A2 → end
    expect(r.appliedCount).toBe(2)
    expect(r.state.ended).toBe(true)
    expect(r.state.error).toBeNull()
    const prose = r.state.log.filter((e) => e.kind === 'narration').map((e: any) => e.text)
    expect(prose).toContain('进了 A。')
    expect(prose).toContain('收束。')
  })

  it('位置越界：停在一致前缀（appliedCount = 前缀长度）', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, [0, 5], RESOLVE) // 第二步位置 5 越界
    expect(r.appliedCount).toBe(1)
    expect(r.state.ended).toBe(false)
    expect(r.state.choices.map((c) => c.text)).toEqual(['A1', 'A2']) // 停在 A 节点的选项前
  })

  it('故事提前结束：剩余 choiceSeq 被安全忽略', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, [1, 0, 0], RESOLVE) // B 直接 -> END，后两步无处可用
    expect(r.appliedCount).toBe(1)
    expect(r.state.ended).toBe(true)
    expect(r.state.error).toBeNull()
  })

  it('确定性：同 seed + 同 choiceSeq 多次重建得逐字一致 PlayState（含 random/shuffle）', () => {
    const { program } = build(RANDOM)
    // RANDOM 的 ~let 是前导块，resolveStart 会落到立即结束的 opening knot；
    // 故此处显式以 '雾号' 为入口，忠实复刻 engine 黄金 trace（seed 5 → dice 5）。
    const a = replay(program, '雾号', 5, [0, 0, 0], RESOLVE)
    const b = replay(program, '雾号', 5, [0, 0, 0], RESOLVE)
    expect(a).toEqual(b)
    const prose = a.state.log.filter((e) => e.kind === 'narration').map((e: any) => e.text)
    expect(prose[0]).toBe('今夜骰子 5 点。') // seed 5 下 random(1,6)=5（engine 黄金 trace）
  })

  it('空 choiceSeq：仅 advance 到首个暂停点', () => {
    const { program, start } = build(TREE)
    const r = replay(program, start, 1, [], RESOLVE)
    expect(r.appliedCount).toBe(0)
    expect(r.state.choices.map((c) => c.text)).toEqual(['A', 'B'])
  })

  it('运行时错误：重放安全停在出错点，state.error 置位、不抛', () => {
    const { program } = build(BOOM)
    // ~let o 前导块落在立即结束的 opening knot（同 RANDOM），故显式以 '起' 为入口。
    // [继续] 这步本身不出错；choose 后 advance 进「雷」节点，插值 o.x 才抛 RuntimeError。
    const r = replay(program, '起', 1, [0], RESOLVE)
    expect(r.state.error).not.toBeNull()
    expect(r.state.ended).toBe(false)
    expect(r.appliedCount).toBe(1) // [继续] 这步已消费，错误发生在其后的 advance 阶段
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
    const r = replay(program, start, 1, [0, 0], RESOLVE) // A → A1 → end
    expect(r.appliedCount).toBe(2)
    expect(r.sfx).toEqual(['a/end.mp3']) // 仅末步，不含中间步的 a.mp3
  })

  it('sfx：空 choiceSeq 时为初始 advance 的 sfx（此例无 → 空）', () => {
    const { program, start } = build(TREE)
    expect(replay(program, start, 1, [], RESOLVE).sfx).toEqual([])
  })
})
