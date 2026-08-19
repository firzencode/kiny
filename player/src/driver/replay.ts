import { createStory, plainText } from '@kiny/engine'
import type { ValidatedProgram, Story } from '@kiny/engine'
import { initialState, advance, choose, submitInput, type PlayState } from './storyDriver'
import type { ResolveAsset } from '../host/commands'

/**
 * 一步读者交互（保位重放的记录单元）。判别联合，`kind` 显式标签区分，
 * 为将来更多交互暂停点（受限输入、多字段表单等）留扩展位。
 * - `choice`：读者点了第 `pos` 个可见选项（0-based；`state.choices[pos].index` 即 `pos`）。
 *   `text` 是记录时该选项的纯文本，重放时若 `pos` 处当前文案与之不符，先在全部当前选项里按文案找回原选项：
 *   唯一匹配则改走那个位置（作者调整了选项顺序，仍续得上原分支）；找不到或有多个同文案匹配（无从判断）则
 *   退回按 `pos` 走。`text` 不参与分歧判定——作者改错别字、改文案不应让存档变得读不了。可选，缺失时只按位置重放（旧记录兼容）。
 * - `input`：读者在 @input 输入框提交了 `text`（读者原文，含前后空白；trim 与空提交保默认由 engine submitInput 负责）。
 */
export type InteractionStep =
  | { kind: 'choice'; pos: number; text?: string }
  | { kind: 'input'; text: string }

export interface ReplayResult {
  /** 重建到最远一致点的 PlayState。 */
  state: PlayState
  /**
   * seq 中成功应用的前缀长度 **+ 触发出错的那一步（若有）**（T069 决策 A7）。运行时出错的那一步照常计入
   * appliedCount（其后步不计），使 `seq.slice(0, appliedCount)` **保留触发出错的交互**——重放能复现该错误、
   * 停在出错处让作者/读者看到问题，胜过悄悄丢弃出错交互。其它分歧（越界/撞非暂停点/提前结束）不计出错步。
   */
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
 * choice 步以位置为主键；可选的 text 只在 pos 处文案不符时参与「找回原选项」（唯一匹配则改用该位置，
 * 否则退回按 pos 走），本身不构成分歧——作者改文案不该让存档读不了，这是本设计要解决的痛点之一。
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
      let pos = s.pos
      // 记了 text 且与当前 pos 处文案不符 → 作者可能调整了选项顺序：按文案在全部可见选项里找回原位置。
      // 唯一匹配才采信（改走该位置，续对分支）；一个都没有或有多个同文案（无从判断）则退回按 pos 走——
      // 前者是作者删了该选项换了新的，后者是文案本身就有重复，两种都不该硬当「找到了」。
      if (s.text !== undefined && plainText(state.choices[pos].spans) !== s.text) {
        const matches: number[] = []
        for (let i = 0; i < state.choices.length; i++) {
          if (plainText(state.choices[i].spans) === s.text) matches.push(i)
        }
        if (matches.length === 1) pos = matches[0]
      }
      const r = choose(story, state, state.choices[pos].index, resolve)
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
