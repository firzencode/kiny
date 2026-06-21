import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles, analyze, resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import type { ResolveAsset } from '@kiny/player'
import { computePreview } from './computePreview'

const RESOLVE: ResolveAsset = (n) => 'mem://' + n

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
  it('有效 program + 空 choiceSeq：advance 到首个暂停点、stale=false', () => {
    const p = prog(TREE)
    const r = computePreview(p, startOf(p), 7, [], RESOLVE, null)
    expect(r.stale).toBe(false)
    expect(r.choiceSeq).toEqual([])
    expect(r.play!.choices.map((c) => c.text)).toEqual(['A', 'B'])
  })

  it('有效路径：完整应用、保位到叶子', () => {
    const p = prog(TREE)
    const r = computePreview(p, startOf(p), 7, [0, 1], RESOLVE, null)
    expect(r.choiceSeq).toEqual([0, 1])
    expect(r.play!.ended).toBe(true)
  })

  it('分歧（位置越界）：choiceSeq 截到一致前缀', () => {
    const p = prog(TREE)
    const r = computePreview(p, startOf(p), 7, [0, 9], RESOLVE, null)
    expect(r.choiceSeq).toEqual([0])
    expect(r.play!.choices.map((c) => c.text)).toEqual(['A1', 'A2'])
  })

  it('program 为 null：冻结上一帧 play、stale=true、choiceSeq 原样保留', () => {
    const p = prog(TREE)
    const good = computePreview(p, startOf(p), 7, [0], RESOLVE, null)
    const frozen = computePreview(null, null, 7, [0], RESOLVE, good.play)
    expect(frozen.stale).toBe(true)
    expect(frozen.play).toBe(good.play)
    expect(frozen.choiceSeq).toEqual([0])
  })

  it('确定性：同 seed+choiceSeq 多次得逐字一致 play', () => {
    const p = prog(TREE)
    const a = computePreview(p, startOf(p), 7, [0, 0], RESOLVE, null)
    const b = computePreview(p, startOf(p), 7, [0, 0], RESOLVE, null)
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
    const r = computePreview(p, startOf(p), 7, [0], RESOLVE, null)
    expect(r.sfx).toEqual(['mem://s.mp3'])
    expect(computePreview(null, null, 7, [0], RESOLVE, r.play).sfx).toEqual([])
  })
})
