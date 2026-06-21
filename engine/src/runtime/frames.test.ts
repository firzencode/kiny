import { describe, it, expect } from 'vitest'
import { FrameStack } from './frames'
import type { ContentBlock } from '../parser/ast'

describe('FrameStack snapshot/restore frames', () => {
  it('snapshotFrames 反映当前帧，restoreFrames 重建', () => {
    const b1: ContentBlock = []
    const b2: ContentBlock = []
    const fs = new FrameStack()
    fs.reset(b1)
    fs.current!.index = 3
    fs.push(b2)
    const snap = fs.snapshotFrames()
    expect(snap.length).toBe(2)
    expect(snap[0]!.block).toBe(b1)
    expect(snap[0]!.index).toBe(3)
    expect(snap[1]!.block).toBe(b2)

    const fs2 = new FrameStack()
    fs2.restoreFrames(snap.map((f) => ({ ...f })))
    expect(fs2.current!.block).toBe(b2)
  })

  it('snapshotFrames 是副本，后续 push 不影响旧快照', () => {
    const b: ContentBlock = []
    const fs = new FrameStack()
    fs.reset(b)
    const snap = fs.snapshotFrames()
    expect(snap.length).toBe(1)
    fs.push(b)
    expect(snap.length).toBe(1)
  })
})
