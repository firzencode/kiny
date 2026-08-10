import { describe, it, expect, vi } from 'vitest'
import type { InteractionStep, PlayState, ResolveAsset } from '@kiny/player'
import type { ValidatedProgram } from '@kiny/engine'
import type { PreviewSnapshot } from '../ai/actions'
import { makePreviewPort, type PreviewPortDeps } from './previewPort'

const RESOLVE: ResolveAsset = (n) => 'mem://' + n
const PROG = { fake: 'program' } as unknown as ValidatedProgram
const PLAY = { fake: 'play' } as unknown as PlayState

/**
 * 搭一套记录调用的依赖：recompute 记参数并把「新序列」当成生效序列回填（模拟真重算的
 * 保位语义），另外故意多带一个 sfx 字段——真 recompute 的返回体就带它。
 */
function makeDeps(seq: InteractionStep[] = [], stale = false) {
  let current = seq
  const calls: { seq: InteractionStep[]; emitSfx: boolean | undefined; cancelledBefore: boolean }[] = []
  let cancels = 0
  const cancel = vi.fn(() => { cancels++ })
  const recompute = vi.fn((
    _prog: ValidatedProgram | null,
    next: InteractionStep[],
    _resolve: ResolveAsset,
    _prev: PlayState | null,
    emitSfx?: boolean,
  ): PreviewSnapshot => {
    calls.push({ seq: next, emitSfx, cancelledBefore: cancels > 0 })
    current = next
    return { play: PLAY, stale: false, interactionSeq: next, sfx: ['mem://s.mp3'] } as PreviewSnapshot
  })
  const deps: PreviewPortDeps = {
    getSeq: () => current,
    getPlay: () => PLAY,
    getStale: () => stale,
    getProgram: () => PROG,
    getResolve: () => RESOLVE,
    recompute,
    cancel,
  }
  return { deps, calls, recompute, cancel, getSeq: () => current }
}

const choice = (pos: number): InteractionStep => ({ kind: 'choice', pos })

describe('makePreviewPort · back（UI「← 上一步」与动作层 back 共用此实现）', () => {
  it('已在起点：不重算、不打断动画，原样回当前快照', () => {
    const { deps, recompute, cancel } = makeDeps([], true)
    const port = makePreviewPort(deps)
    const r = port.back()
    // 这条是整个 back 的真风险：slice(0,-1) 得空数组，若照常重算就等于 restart，
    // 会把预览打回开头。UI 那侧起点处按钮禁用、点不到，只有这里测得出。
    expect(recompute).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(r).toEqual({ play: PLAY, stale: true, interactionSeq: [] })
  })

  it('有交互：按 seq.slice(0,-1) 重算、先打断动画、不出声', () => {
    const { deps, calls, cancel } = makeDeps([choice(0), choice(1), choice(2)])
    const port = makePreviewPort(deps)
    const r = port.back()
    expect(calls).toHaveLength(1)
    expect(calls[0].seq).toEqual([choice(0), choice(1)])
    expect(calls[0].emitSfx).toBeFalsy() // 后退是调试动作，不该重放音效
    expect(calls[0].cancelledBefore).toBe(true) // cancel 必须在 recompute 之前
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(r.interactionSeq).toEqual([choice(0), choice(1)])
  })

  it('连退到起点后再退：最后一次退空，之后不再重算', () => {
    const { deps, recompute } = makeDeps([choice(0)])
    const port = makePreviewPort(deps)
    expect(port.back().interactionSeq).toEqual([])
    expect(recompute).toHaveBeenCalledTimes(1)
    port.back()
    expect(recompute).toHaveBeenCalledTimes(1) // 空序列那次没再调
  })

  it('返回体只有 PreviewSnapshot 的三个字段——recompute 带的 sfx 不漏给对外快照', () => {
    const { deps } = makeDeps([choice(0)])
    const port = makePreviewPort(deps)
    expect(Object.keys(port.back()).sort()).toEqual(['interactionSeq', 'play', 'stale'])
    expect(Object.keys(port.back()).sort()).toEqual(['interactionSeq', 'play', 'stale']) // 空序列分支同形状
  })
})

describe('makePreviewPort · 既有命令', () => {
  it('choose / submitInput 追加一步并出声，restart 清空且不出声', () => {
    const { deps, calls } = makeDeps([choice(0)])
    const port = makePreviewPort(deps)
    port.choose(3)
    expect(calls[0].seq).toEqual([choice(0), { kind: 'choice', pos: 3 }])
    expect(calls[0].emitSfx).toBe(true)
    port.submitInput('旅人')
    expect(calls[1].seq).toEqual([choice(0), { kind: 'choice', pos: 3 }, { kind: 'input', text: '旅人' }])
    expect(calls[1].emitSfx).toBe(true)
    port.restart()
    expect(calls[2].seq).toEqual([])
    expect(calls[2].emitSfx).toBeFalsy()
  })

  it('snapshot 直接反映当前运行态，不触发重算', () => {
    const { deps, recompute } = makeDeps([choice(0), choice(1)], true)
    const port = makePreviewPort(deps)
    expect(port.snapshot()).toEqual({ play: PLAY, stale: true, interactionSeq: [choice(0), choice(1)] })
    expect(recompute).not.toHaveBeenCalled()
  })
})
