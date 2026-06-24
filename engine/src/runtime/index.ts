import type { ValidatedProgram } from '../analyze/types'
import { Story } from './story'
import type { StoryOptions } from './types'
import { enumerateChoices, resolveBlock, fingerprint } from './snapshot'
import type { StorySnapshot, RestoreData } from './snapshot'
import type { Frame } from './frames'

export { Story } from './story'
export type { OutputEvent, ChoiceView, StoryOptions } from './types'
export { RuntimeError } from './types'
export type { StorySnapshot } from './snapshot'
export type { RichSpan } from './spans'
export { plainText } from './spans'

export function createStory(program: ValidatedProgram, options: StoryOptions): Story {
  return new Story(program, options)
}

// restore 分支会 rng.setState 覆盖，故此 seed 值无关紧要。
const RESTORE_SEED = 0x9e3779b9

/**
 * 从快照重建 Story：先校验版本与 program 指纹，再把序号 / 路径解码回 AST 引用。
 * 指纹失配 / 解码失败用判别式结果表达，不抛——调用方据 reason 优雅降级。
 */
export function restoreStory(
  program: ValidatedProgram,
  snapshot: StorySnapshot,
):
  | { ok: true; story: Story }
  | { ok: false; reason: 'fingerprint-mismatch' | 'corrupt' } {
  if (!snapshot || snapshot.version !== 1) return { ok: false, reason: 'corrupt' }
  if (fingerprint(program) !== snapshot.fingerprint) {
    return { ok: false, reason: 'fingerprint-mismatch' }
  }
  try {
    const { list } = enumerateChoices(program)
    const taken = snapshot.taken.map((n) => {
      const c = list[n]
      if (!c) throw new Error(`taken 序号越界：${n}`)
      return c
    })
    const knot = program.knots.get(snapshot.current.knot)
    if (!knot) throw new Error(`currentKnot 不存在：${snapshot.current.knot}`)
    const frames: Frame[] = snapshot.stack.map((s) => ({
      block: resolveBlock(program, s.path),
      index: s.index,
    }))
    const restore: RestoreData = {
      turns: snapshot.turns,
      ended: snapshot.ended,
      globals: snapshot.globals,
      rng: snapshot.rng,
      variantCounters: snapshot.variantCounters,
      visitedAt: snapshot.visitedAt,
      taken,
      currentKnot: knot,
      currentStitch: snapshot.current.stitch ?? null,
      localIsGlobal: snapshot.current.localIsGlobal,
      locals: snapshot.current.locals,
      frames,
    }
    const story = new Story(program, { start: snapshot.current.knot, seed: RESTORE_SEED }, restore)
    return { ok: true, story }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}
