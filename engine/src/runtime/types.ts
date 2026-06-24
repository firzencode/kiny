import type { RichSpan } from './spans'

export type OutputEvent =
  | { kind: 'text'; spans: RichSpan[] }
  | { kind: 'command'; name: string; args: unknown[] }

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
