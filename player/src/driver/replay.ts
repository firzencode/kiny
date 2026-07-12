import { createStory } from '@kiny/engine'
import type { ValidatedProgram, Story } from '@kiny/engine'
import { initialState, advance, choose, submitInput, type PlayState } from './storyDriver'
import type { ResolveAsset } from '../host/commands'

/**
 * 一步读者交互（保位重放的记录单元）。判别联合，`kind` 显式标签区分，
 * 为将来更多交互暂停点（受限输入、多字段表单等）留扩展位。
 * - `choice`：读者点了第 `pos` 个可见选项（0-based；`state.choices[pos].index` 即 `pos`，回放对选项文案改动免疫）。
 * - `input`：读者在 @input 输入框提交了 `text`（读者原文，含前后空白；trim 与空提交保默认由 engine submitInput 负责）。
 */
export type InteractionStep =
  | { kind: 'choice'; pos: number }
  | { kind: 'input'; text: string }

export interface ReplayResult {
  /** 重建到最远一致点的 PlayState。 */
  state: PlayState
  /** seq 中被成功应用的前缀长度（分歧时 < seq.length）。 */
  appliedCount: number
  /** 最后一步（最后一次成功 choose/submitInput；seq 空则初始 advance）的瞬时 sfx。中间历史步全部丢弃，故重放不重播过往音效。 */
  sfx: string[]
}

/** 同 {@link ReplayResult}，额外带上内部创建的活 Story 实例，供继续现场推进（editor 预览打字动画用）。 */
export interface ReplayToStoryResult extends ReplayResult {
  story: Story
}

/**
 * 确定性保位重放的公共核心：固定 seed 建 Story，按交互序列 seq（choice | input 步）逐步重放。
 * 分歧四种 —— 选项位置越界 / 输入步撞非输入暂停点 / 故事提前结束 / 运行时出错 —— 都安全停在「最远一致点」。
 * choice 步的重放键是位置；engine 的 ChoiceView.index 即可见选项的位序，故 state.choices[pos].index 就是 pos，重放对选项文案改动免疫。
 * input 步先校验 state.input !== null 再提交（对偶「选项越界截断」），绝不硬调 submitInput 撞引擎「当前无待填输入框」错。
 * 额外返回内部创建的活 Story：{@link replay} 剥掉它，{@link replayToStory} 原样透出。
 */
function replayCore(
  program: ValidatedProgram,
  start: string,
  seed: number,
  seq: InteractionStep[],
  resolve: ResolveAsset,
): ReplayToStoryResult {
  const story = createStory(program, { start, seed })
  const first = advance(story, initialState, resolve)
  let state = first.state
  let sfx = first.sfx // 只保留最后一步的瞬时 sfx，中间历史步全部丢弃
  let appliedCount = 0
  for (const s of seq) {
    if (state.ended || state.error) break // 故事提前结束 / 运行时错 → 停
    if (s.kind === 'choice') {
      if (s.pos < 0 || s.pos >= state.choices.length) break // 位置越界 / 当前非选项暂停点 → 停在一致前缀
      const r = choose(story, state, state.choices[s.pos].index, resolve)
      state = r.state
      sfx = r.sfx
    } else {
      if (state.input === null) break // 当前非输入暂停点（作者删了 @input 等）→ 截断
      const r = submitInput(story, state, s.text, resolve)
      state = r.state
      sfx = r.sfx
    }
    appliedCount++
  }
  return { story, state, appliedCount, sfx }
}

/** 确定性保位重放：重建到交互序列 seq 的最远一致点。算法与分歧处理见 {@link replayCore}。 */
export function replay(
  program: ValidatedProgram,
  start: string,
  seed: number,
  seq: InteractionStep[],
  resolve: ResolveAsset,
): ReplayResult {
  const r = replayCore(program, start, seed, seq, resolve)
  return { state: r.state, appliedCount: r.appliedCount, sfx: r.sfx }
}

/** 同 {@link replay}，额外返回内部创建的活 Story，供调用方在重放到的位置继续现场 `chooseStep` / `submitInputStep` / `step`。 */
export function replayToStory(
  program: ValidatedProgram,
  start: string,
  seed: number,
  seq: InteractionStep[],
  resolve: ResolveAsset,
): ReplayToStoryResult {
  return replayCore(program, start, seed, seq, resolve)
}
