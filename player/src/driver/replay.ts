import { createStory } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import { initialState, advance, choose, type PlayState } from './storyDriver'
import type { ResolveAsset } from '../host/commands'

export interface ReplayResult {
  /** 重建到最远一致点的 PlayState。 */
  state: PlayState
  /** choiceSeq 中被成功应用的前缀长度（分歧时 < choiceSeq.length）。 */
  appliedCount: number
  /** 最后一步（最后一次成功 choose；choiceSeq 空则初始 advance）的瞬时 sfx。中间历史步全部丢弃，故重放不重播过往音效。 */
  sfx: string[]
}

/**
 * 确定性保位重放：固定 seed 建 Story，按 choiceSeq（可见选项「位置」序列）逐步重放。
 * 分歧三种 —— 位置越界 / 故事提前结束或出错 —— 都安全停在「最远一致点」。
 * 重放键是位置；engine 的 ChoiceView.index 即可见选项的位序，故 state.choices[pos].index 就是 pos，重放对选项文案改动免疫。
 */
export function replay(
  program: ValidatedProgram,
  start: string,
  seed: number,
  choiceSeq: number[],
  resolve: ResolveAsset,
): ReplayResult {
  const story = createStory(program, { start, seed })
  const first = advance(story, initialState, resolve)
  let state = first.state
  let sfx = first.sfx                              // 末步覆盖：只保留最后一步的瞬时 sfx
  let appliedCount = 0
  for (const pos of choiceSeq) {
    if (state.ended || state.error) break          // 故事提前结束 / 运行时错 → 停
    if (pos < 0 || pos >= state.choices.length) break // 位置越界 → 停一致前缀
    const r = choose(story, state, state.choices[pos].index, resolve)
    state = r.state
    sfx = r.sfx
    appliedCount++
  }
  return { state, appliedCount, sfx }
}
