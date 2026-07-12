import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles, analyze, resolveStart, plainText } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import type { ResolveAsset, InteractionStep } from '@kiny/player'
import { computePreview } from './computePreview'

const RESOLVE: ResolveAsset = (n) => 'mem://' + n

/** 简写：位置序列 → choice 交互步序列。 */
const choices = (...ps: number[]): InteractionStep[] => ps.map((pos) => ({ kind: 'choice', pos }))

function prog(kin: string): ValidatedProgram {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: 't', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load')
  const { program } = analyze(res.files)
  if (!program) throw new Error('analyze')
  return program
}
function startOf(p: ValidatedProgram) { return resolveStart(p, 'main.kin')! }

const TREE = `开场。
* [A] -> a
* [B] -> b
=== a ===
进了 A。
* [A1] -> end
* [A2] -> end
=== b ===
-> END
=== end ===
收束。
-> END
`

describe('computePreview', () => {
  it('有效 program + 空交互序列：advance 到首个暂停点、stale=false', () => {
    const p = prog(TREE)
    const r = computePreview(p, startOf(p), 7, [], RESOLVE, null)
    expect(r.stale).toBe(false)
    expect(r.interactionSeq).toEqual([])
    expect(r.play!.choices.map((c) => plainText(c.spans))).toEqual(['A', 'B'])
  })

  it('有效路径：完整应用、保位到叶子', () => {
    const p = prog(TREE)
    const r = computePreview(p, startOf(p), 7, choices(0, 1), RESOLVE, null)
    expect(r.interactionSeq).toEqual(choices(0, 1))
    expect(r.play!.ended).toBe(true)
  })

  it('分歧（位置越界）：交互序列截到一致前缀', () => {
    const p = prog(TREE)
    const r = computePreview(p, startOf(p), 7, choices(0, 9), RESOLVE, null)
    expect(r.interactionSeq).toEqual(choices(0))
    expect(r.play!.choices.map((c) => plainText(c.spans))).toEqual(['A1', 'A2'])
  })

  it('input 步：吃 {kind:input}、保位停在输入框、序列含该步', () => {
    const INPUT = `~ let name = "旅人"
开场。
* [进] -> a
=== a ===
@input(name, "名字")
你好，{name}。
-> END
`
    const p = prog(INPUT)
    // 走到 @input（choice 进 → 停输入框），提交 '晓' 应用完整
    const atInput = computePreview(p, startOf(p), 7, choices(0), RESOLVE, null)
    expect(atInput.play!.input).toEqual({ placeholder: '名字' })
    const seq: InteractionStep[] = [{ kind: 'choice', pos: 0 }, { kind: 'input', text: '晓' }]
    const r = computePreview(p, startOf(p), 7, seq, RESOLVE, null)
    expect(r.interactionSeq).toEqual(seq)
    expect(r.play!.ended).toBe(true)
    const prose = r.play!.log.filter((e) => e.kind === 'narration').map((e: any) => plainText(e.spans))
    expect(prose).toContain('你好，晓。')
  })

  it('program 为 null：冻结上一帧 play、stale=true、交互序列原样保留', () => {
    const p = prog(TREE)
    const good = computePreview(p, startOf(p), 7, choices(0), RESOLVE, null)
    const frozen = computePreview(null, null, 7, choices(0), RESOLVE, good.play)
    expect(frozen.stale).toBe(true)
    expect(frozen.play).toBe(good.play)
    expect(frozen.interactionSeq).toEqual(choices(0))
  })

  it('确定性：同 seed+交互序列多次得逐字一致 play', () => {
    const p = prog(TREE)
    const a = computePreview(p, startOf(p), 7, choices(0, 0), RESOLVE, null)
    const b = computePreview(p, startOf(p), 7, choices(0, 0), RESOLVE, null)
    expect(a.play).toEqual(b.play)
  })

  it('sfx：透传末步音效；program 为 null 的冻结分支为空', () => {
    const SFX = `开场。
* [A] -> a
=== a ===
@sfx("s.mp3")
进 A。
-> END
`
    const p = prog(SFX)
    const r = computePreview(p, startOf(p), 7, choices(0), RESOLVE, null)
    expect(r.sfx).toEqual(['mem://s.mp3'])
    expect(computePreview(null, null, 7, choices(0), RESOLVE, r.play).sfx).toEqual([])
  })
})
