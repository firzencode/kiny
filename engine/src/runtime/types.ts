import type { RichSpan } from './spans'

/** 固定区域槽位（`@panel` 的第一个参数）：左 / 右侧边栏、底部栏、正文后固定栏。 */
export type PanelSlot = 'left' | 'right' | 'bottom' | 'after'

export const PANEL_SLOTS: readonly PanelSlot[] = ['left', 'right', 'bottom', 'after']

export type OutputEvent =
  | { kind: 'text'; spans: RichSpan[] }
  | { kind: 'command'; name: string; args: unknown[] }
  /**
   * 固定区域内容更新（`@panel` 登记的活模板重估后**有变化**才发）。
   * `spans` 为空 = 清空并隐藏该槽。与 text 不同：整体改写、无揭示流程。
   */
  | { kind: 'panel'; slot: PanelSlot; spans: RichSpan[] }

/** 呈现给玩家的选项（列表富文本 + 在 currentChoices 中的下标）。 */
export interface ChoiceView {
  spans: RichSpan[]
  index: number
}

export interface StoryOptions {
  start: string
  seed?: number
}

/** 运行期错误：JS 抛错、死循环、缺目标等，带源定位。 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly line?: number,
  ) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'RuntimeError'
  }
}
