import { replay, type PlayState, type ResolveAsset, type InteractionStep } from '@kiny/player'
import type { ValidatedProgram } from '@kiny/engine'

export interface PreviewSnapshot {
  /** 当前应渲染的 PlayState；program 从无到有前可能为 null。 */
  play: PlayState | null
  /** 实际生效的交互序列（分歧时已截到最远一致前缀）。 */
  interactionSeq: InteractionStep[]
  /** 预览是否基于上一个有效版本（program 当前无效而冻结）。 */
  stale: boolean
  /** 最后一步的瞬时 sfx（透传 replay）；是否真正出声由调用方按「点选项 vs 编辑重算」决定。 */
  sfx: string[]
}

/**
 * 纯保位重放（spec §5.3）。
 * - program 有效：replay(seed, seq) 重建，交互序列截到 appliedCount（分歧停最远一致点），stale=false。
 * - program 为 null：冻结 prevPlay、交互序列原样、stale=true。
 * 点选项 / 提交输入 = 调用方把 {kind:'choice',pos} / {kind:'input',text} 追加进序列后再调本函数
 * （纯函数，确定性，无需持有可变 Story）。
 */
export function computePreview(
  program: ValidatedProgram | null,
  start: string | null,
  seed: number,
  seq: InteractionStep[],
  resolve: ResolveAsset,
  prevPlay: PlayState | null,
): PreviewSnapshot {
  if (program === null || start === null) {
    return { play: prevPlay, interactionSeq: seq, stale: true, sfx: [] }
  }
  const r = replay(program, start, seed, seq, resolve)
  return { play: r.state, interactionSeq: seq.slice(0, r.appliedCount), stale: false, sfx: r.sfx }
}
