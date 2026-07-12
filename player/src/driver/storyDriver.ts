import { RuntimeError } from '@kiny/engine'
import type { Story, ChoiceView, RichSpan } from '@kiny/engine'
import { type HostState, type ResolveAsset, emptyHost, applyCommand } from '../host/commands'

export type LogEntry = { kind: 'narration'; spans: RichSpan[] } | { kind: 'end' }

/** 待填输入框的可呈现态（varName 是 engine 内部事，宿主渲染不需要，故不下放）。 */
export interface InputView {
  placeholder: string | null
}

export interface PlayState {
  log: LogEntry[]
  host: HostState
  choices: ChoiceView[]
  /** 停在 @input 输入框时非空；与 choices 互斥（同一时刻至多其一）。 */
  input: InputView | null
  ended: boolean
  error: { message: string; file?: string; line?: number } | null
}

export const initialState: PlayState = {
  log: [], host: emptyHost, choices: [], input: null, ended: false, error: null,
}

/** advance/choose 的结果：归约后的持续状态 + 本次推进新触发的瞬时音效。 */
export interface AdvanceResult {
  state: PlayState
  /** 本次推进新触发的一次性音效 URL（已 resolve，可多个，顺序与触发序一致）。瞬时，不进 PlayState。 */
  sfx: string[]
}

function asError(err: unknown): PlayState['error'] {
  if (err instanceof RuntimeError) return { message: err.message, file: err.file, line: err.line }
  throw err
}

/** 归约单个事件：文字进 log（并标记产出一行）、sfx 瞬时收集、clear 清 log、其余走 applyCommand。 */
function reduceEvent(
  e: ReturnType<Story['continue']>,
  log: LogEntry[],
  host: HostState,
  sfx: string[],
  resolve: ResolveAsset,
): { log: LogEntry[]; host: HostState; producedLine: boolean } {
  if (e.kind === 'text') return { log: [...log, { kind: 'narration', spans: e.spans }], host, producedLine: true }
  if (e.name === 'sfx') {
    sfx.push(resolve(String(e.args[0]))) // 一次性音效：瞬时收集，不进 host
    return { log, host, producedLine: false }
  }
  if (e.name === 'clear') return { log: [], host, producedLine: false } // 清屏：清空已显示正文；bg/bgm 不动
  return { log, host: applyCommand(host, e, resolve), producedLine: false }
}

/** 抵暂停点后归约输入框 / 选项 / 结束态。 */
function pauseState(story: Story, log: LogEntry[], host: HostState): PlayState {
  if (story.hasEnded) return { log: [...log, { kind: 'end' }], host, choices: [], input: null, ended: true, error: null }
  const input = story.currentInput
  if (input !== null) {
    // 停在输入框：必须先于下面「choices 空 → 视同结束」兜底判定，否则输入暂停会被误判成结束。
    return { log, host, choices: [], input: { placeholder: input.placeholder }, ended: false, error: null }
  }
  const choices = story.currentChoices
  if (choices.length === 0) {
    // 无可见选项又未结束（同 cli player）：视同结束
    return { log: [...log, { kind: 'end' }], host, choices: [], input: null, ended: true, error: null }
  }
  return { log, host, choices, input: null, ended: false, error: null }
}

/** 从当前 Story 一次排空到下一个暂停点（选项 / 结束 / 出错），归约出新 PlayState + 本次瞬时 sfx。
 * 用于 replay / restore / 编辑器跳转的最终态重建（无动画）。现场前向播放改用 `step`。 */
export function advance(story: Story, prev: PlayState, resolve: ResolveAsset): AdvanceResult {
  let log = prev.log
  let host = prev.host
  const sfx: string[] = []
  try {
    while (story.canContinue) {
      const r = reduceEvent(story.continue(), log, host, sfx, resolve)
      log = r.log
      host = r.host
    }
  } catch (err) {
    return { state: { ...prev, log, host, choices: [], input: null, error: asError(err) }, sfx }
  }
  return { state: pauseState(story, log, host), sfx }
}

/**
 * 逐事件推进：途经命令（bg/sfx/clear/打字机设定）**即时应用**，**产出一行 narration 即返回**，
 * 或抵暂停点（选项 / 结束 / 出错）返回。保证 bg/sfx/clear 与该行揭示同步（advance 一次排空会让
 * 命令早于其文字触发、失同步）。不变量：连续 `step` 累积态 == 一次 `advance` 排空的结果。
 */
export function step(story: Story, prev: PlayState, resolve: ResolveAsset): AdvanceResult {
  // 已结束 / 出错态：no-op（防御——重复 step 不再追加第二个 end 标记，含 StrictMode 重入）。
  if (prev.ended || prev.error) return { state: prev, sfx: [] }
  let log = prev.log
  let host = prev.host
  const sfx: string[] = []
  try {
    while (story.canContinue) {
      const r = reduceEvent(story.continue(), log, host, sfx, resolve)
      log = r.log
      host = r.host
      if (r.producedLine) {
        // 产出一行即返回：尚未抵暂停点 → choices=[]、input=null、未结束（由后续 step 抵达）。
        return { state: { log, host, choices: [], input: null, ended: false, error: null }, sfx }
      }
    }
  } catch (err) {
    return { state: { ...prev, log, host, choices: [], input: null, error: asError(err) }, sfx }
  }
  return { state: pauseState(story, log, host), sfx }
}

/** 玩家选择 index（= ChoiceView.index），推进 Story 后**一次排空**到下一个暂停点（最终态，无动画）。 */
export function choose(story: Story, prev: PlayState, index: number, resolve: ResolveAsset): AdvanceResult {
  try {
    story.choose(index)
  } catch (err) {
    return { state: { ...prev, choices: [], input: null, error: asError(err) }, sfx: [] }
  }
  return advance(story, { ...prev, choices: [] }, resolve)
}

/** 同 choose，但选后只 `step` 一行（供 usePlayback 逐行揭示后续正文）。 */
export function chooseStep(story: Story, prev: PlayState, index: number, resolve: ResolveAsset): AdvanceResult {
  try {
    story.choose(index)
  } catch (err) {
    return { state: { ...prev, choices: [], input: null, error: asError(err) }, sfx: [] }
  }
  return step(story, { ...prev, choices: [] }, resolve)
}

/** 读者提交输入框文本，推进 Story 后**一次排空**到下一个暂停点（最终态，无动画；replay / editor 预览用）。 */
export function submitInput(story: Story, prev: PlayState, text: string, resolve: ResolveAsset): AdvanceResult {
  try {
    story.submitInput(text)
  } catch (err) {
    return { state: { ...prev, input: null, error: asError(err) }, sfx: [] }
  }
  return advance(story, { ...prev, input: null }, resolve)
}

/** 同 submitInput，但提交后只 `step` 一行（供 usePlayback 逐行揭示后续正文）。 */
export function submitInputStep(story: Story, prev: PlayState, text: string, resolve: ResolveAsset): AdvanceResult {
  try {
    story.submitInput(text)
  } catch (err) {
    return { state: { ...prev, input: null, error: asError(err) }, sfx: [] }
  }
  return step(story, { ...prev, input: null }, resolve)
}
