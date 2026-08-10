import type { PlayState, InteractionStep, ResolveAsset } from '@kiny/player'
import type { ValidatedProgram } from '@kiny/engine'
import type { PreviewPort, PreviewSnapshot } from '../ai/actions'

/**
 * 端口所需的运行态取值与副作用，由 App 注入（都读 ref，故端口对象本身引用稳定）。
 * 抽成注入式是为了让端口逻辑离开 App 可单测——尤其 `back` 的空序列分支，
 * 写错就退化成 restart，而 UI 那边起点处按钮是禁用的、点不到，测不出来。
 */
export interface PreviewPortDeps {
  getSeq(): InteractionStep[]
  getPlay(): PlayState | null
  getStale(): boolean
  getProgram(): ValidatedProgram | null
  getResolve(): ResolveAsset
  /** 保位重算：写回 App 的预览状态并返回新快照。emitSfx 默认 false（只有点选项那条路出声）。 */
  recompute(
    prog: ValidatedProgram | null,
    seq: InteractionStep[],
    resolve: ResolveAsset,
    prev: PlayState | null,
    emitSfx?: boolean,
  ): PreviewSnapshot
  /** 中止在飞的人工打字动画（否则动画后续的 doStep 会覆盖刚重算出的瞬时态）。 */
  cancel(): void
}

/**
 * 预览端口（动作层 `preview` / `choose` / `submitInput` / `restart` / `back` 委派于此）。
 *
 * 这是**内置 AI、外部控制、UI 按钮共用的同一处实现**——UI 的「← 上一步」也走 `back`，
 * 不留两份逻辑各自演化。
 */
export function makePreviewPort(d: PreviewPortDeps): PreviewPort {
  const snapshot = (): PreviewSnapshot => ({
    play: d.getPlay(),
    stale: d.getStale(),
    interactionSeq: d.getSeq(),
  })
  /** 裁到 PreviewSnapshot 的三个字段：recompute 的返回体还带 sfx，不该漏进对外快照。 */
  const trim = (s: PreviewSnapshot): PreviewSnapshot => ({
    play: s.play,
    stale: s.stale,
    interactionSeq: s.interactionSeq,
  })
  const step = (seq: InteractionStep[], emitSfx?: boolean): PreviewSnapshot => {
    d.cancel()
    return trim(d.recompute(d.getProgram(), seq, d.getResolve(), d.getPlay(), emitSfx))
  }
  return {
    snapshot,
    choose: (pos) => step([...d.getSeq(), { kind: 'choice', pos }], true),
    submitInput: (text) => step([...d.getSeq(), { kind: 'input', text }], true),
    restart: () => step([]),
    back: () => {
      const seq = d.getSeq()
      // 已在起点：**不重算**。slice(0,-1) 得空数组，重算等于 restart——那会把作者/agent
      // 的预览打回开头。这不是错误态，原样回当前快照即可（能不能退看 interactionSeq 长度）。
      if (seq.length === 0) return snapshot()
      return step(seq.slice(0, -1))
    },
  }
}
