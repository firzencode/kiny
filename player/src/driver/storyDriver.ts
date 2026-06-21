import { RuntimeError } from '@kiny/engine'
import type { Story, ChoiceView } from '@kiny/engine'
import { type HostState, type ResolveAsset, emptyHost, applyCommand } from '../host/commands'

export type LogEntry = { kind: 'narration'; text: string } | { kind: 'end' }

export interface PlayState {
  log: LogEntry[]
  host: HostState
  choices: ChoiceView[]
  ended: boolean
  error: { message: string; file?: string; line?: number } | null
}

export const initialState: PlayState = {
  log: [], host: emptyHost, choices: [], ended: false, error: null,
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

/** 从当前 Story 推进到下一个暂停点（选项 / 结束 / 出错），归约出新 PlayState + 本次瞬时 sfx。 */
export function advance(story: Story, prev: PlayState, resolve: ResolveAsset): AdvanceResult {
  let log = prev.log
  let host = prev.host
  const sfx: string[] = []
  try {
    while (story.canContinue) {
      const e = story.continue()
      if (e.kind === 'text') log = [...log, { kind: 'narration', text: e.text }]
      else if (e.name === 'sfx') sfx.push(resolve(String(e.args[0]))) // 一次性音效：瞬时收集，不进 host
      else host = applyCommand(host, e, resolve)
    }
  } catch (err) {
    return { state: { ...prev, log, host, choices: [], error: asError(err) }, sfx }
  }
  if (story.hasEnded) {
    return { state: { log: [...log, { kind: 'end' }], host, choices: [], ended: true, error: null }, sfx }
  }
  const choices = story.currentChoices
  if (choices.length === 0) {
    // 无可见选项又未结束（同 cli player）：视同结束
    return { state: { log: [...log, { kind: 'end' }], host, choices: [], ended: true, error: null }, sfx }
  }
  return { state: { log, host, choices, ended: false, error: null }, sfx }
}

/** 玩家选择 index（= ChoiceView.index），推进 Story 后归约到下一个暂停点 + 本次瞬时 sfx。 */
export function choose(story: Story, prev: PlayState, index: number, resolve: ResolveAsset): AdvanceResult {
  try {
    story.choose(index)
  } catch (err) {
    return { state: { ...prev, choices: [], error: asError(err) }, sfx: [] }
  }
  return advance(story, { ...prev, choices: [] }, resolve)
}
