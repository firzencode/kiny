import type { StorySnapshot } from '@kiny/engine'
import type { PlayState } from '@kiny/player'

/** 自动续读那条存档的固定 id（每书唯一一条，持续覆盖）。 */
export const AUTO_SAVE_ID = 'auto'

/**
 * 一条存档：引擎快照（续推用）+ 渲染态 PlayState（当前屏的滚屏 / 背景 / 选项）+ 元信息。
 *
 * 为何同时存 snapshot 与 play：snapshot 只含引擎 runtime（位置 / 栈 / 变量 / rng），
 * 续读做后续选择必须靠它重建 Story；而 PlayState 的 log（叙事滚屏）/ host（背景 bgm）/ choices
 * 是 player 侧累积、**不在引擎快照里**——纯从恢复的 Story 重建只剩当前选项、丢滚屏与背景。
 * 故连 play 一起存：读档时 restoreStory(snapshot) 重建 runtime、直接用 play 渲染当前屏。
 */
export interface SaveRecord {
  /** 自动存档恒为 AUTO_SAVE_ID；手动存档为十六进制 id。 */
  id: string
  kind: 'auto' | 'manual'
  snapshot: StorySnapshot
  play: PlayState
  meta: {
    /** 毫秒时间戳（存档时刻）。 */
    timestamp: number
    /** 预览标签（当前节点 / 末行片段），列表展示用。 */
    label: string
  }
}
