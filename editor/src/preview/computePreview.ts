import { replay, type PlayState, type ResolveAsset } from '@kiny/player'
import type { ValidatedProgram } from '@kiny/engine'

export interface PreviewSnapshot {
  /** 当前应渲染的 PlayState；program 从无到有前可能为 null。 */
  play: PlayState | null
  /** 实际生效的 choiceSeq（分歧时已截到最远一致前缀）。 */
  choiceSeq: number[]
  /** 预览是否基于上一个有效版本（program 当前无效而冻结）。 */
  stale: boolean
  /** 最后一步的瞬时 sfx（透传 replay）；是否真正出声由调用方按「点选项 vs 编辑重算」决定。 */
  sfx: string[]
}

/**
 * 纯保位重放（spec §5.3）。
 * - program 有效：replay(seed, choiceSeq) 重建，choiceSeq 截到 appliedCount（分歧停最远一致点），stale=false。
 * - program 为 null：冻结 prevPlay、choiceSeq 原样、stale=true。
 * 点选项 = 调用方把 pos 追加进 choiceSeq 后再调本函数（纯函数，确定性，无需持有可变 Story）。
 */
export function computePreview(
  program: ValidatedProgram | null,
  start: string | null,
  seed: number,
  choiceSeq: number[],
  resolve: ResolveAsset,
  prevPlay: PlayState | null,
): PreviewSnapshot {
  if (program === null || start === null) {
    return { play: prevPlay, choiceSeq, stale: true, sfx: [] }
  }
  const r = replay(program, start, seed, choiceSeq, resolve)
  return { play: r.state, choiceSeq: choiceSeq.slice(0, r.appliedCount), stale: false, sfx: r.sfx }
}
