import type { ContentBlock } from '../parser/ast'

export interface Frame {
  block: ContentBlock
  index: number
}

/** 帧栈：栈顶帧的 block[index] 即游标。跳转 reset 另起一根；选项/@if push 子帧、耗尽 pop。 */
export class FrameStack {
  private frames: Frame[] = []

  get current(): Frame | undefined {
    return this.frames[this.frames.length - 1]
  }

  /** 清空并以 block 为唯一根帧（跳转语义）。 */
  reset(block: ContentBlock): void {
    this.frames = [{ block, index: 0 }]
  }

  /** 压一子帧（进选项体 / @if 分支体）。 */
  push(block: ContentBlock): void {
    this.frames.push({ block, index: 0 })
  }

  pop(): void {
    this.frames.pop()
  }

  /** 取当前帧的副本数组（状态快照用，不暴露内部引用）。 */
  snapshotFrames(): readonly Frame[] {
    return this.frames.map((f) => ({ ...f }))
  }

  /** 整体替换帧栈（从快照恢复用）。 */
  restoreFrames(frames: Frame[]): void {
    this.frames = frames.map((f) => ({ ...f }))
  }
}
