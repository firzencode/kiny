import type { ValidatedProgram } from '../analyze/types'
import { Story } from './story'
import { RuntimeError } from './types'
import type { StoryOptions } from './types'
import { enumerateChoices, resolveBlock, fingerprint } from './snapshot'
import type { StorySnapshot, RestoreData, ParkData } from './snapshot'
import { GOLDEN_SEED } from './rng'
import type { Frame } from './frames'

export { Story } from './story'
export type { OutputEvent, ChoiceView, StoryOptions, PanelSlot } from './types'
export { RuntimeError } from './types'
export type { StorySnapshot } from './snapshot'
export type { RichSpan } from './spans'
export { plainText } from './spans'

export function createStory(program: ValidatedProgram, options: StoryOptions): Story {
  return new Story(program, options)
}

// restore 分支会 rng.setState 覆盖，故此 seed 值无关紧要。
const RESTORE_SEED = GOLDEN_SEED

/**
 * 从快照重建 Story：先校验版本与 program 指纹，再把序号 / 路径解码回 AST 引用（解码 try），
 * 最后构造 Story（构造 try）。失败用判别式结果表达，不抛——调用方据 reason 优雅降级：
 * - `fingerprint-mismatch`：故事已改，存档与之不匹配。
 * - `corrupt`：**存档数据坏**（版本不符 / 序号越界 / knot 不存在 / resolveBlock 失败）——解码期失败。
 * - `story-error`：**作者脚本坏**（构造期跑 preamble 抛 RuntimeError）——存档没坏、从头开始一样炸。
 * 两类失败处置不同：corrupt 从头开始能救，story-error 不能，故分开。
 */
export function restoreStory(
  program: ValidatedProgram,
  snapshot: StorySnapshot,
):
  | { ok: true; story: Story }
  | { ok: false; reason: 'fingerprint-mismatch' }
  | { ok: false; reason: 'corrupt'; detail?: string }
  | { ok: false; reason: 'story-error'; message: string } {
  if (!snapshot || snapshot.version !== 4) return { ok: false, reason: 'corrupt' }
  if (fingerprint(program) !== snapshot.fingerprint) {
    return { ok: false, reason: 'fingerprint-mismatch' }
  }

  let restore: RestoreData
  try {
    const { list } = enumerateChoices(program)
    const decodeChoice = (n: number) => {
      const c = list[n]
      if (!c) throw new Error(`choice 序号越界：${n}`)
      return c
    }
    const taken = snapshot.taken.map(decodeChoice)
    const knot = program.knots.get(snapshot.current.knot)
    if (!knot) throw new Error(`currentKnot 不存在：${snapshot.current.knot}`)
    const frames: Frame[] = snapshot.stack.map((s) => ({
      block: resolveBlock(program, s.path),
      index: s.index,
    }))
    let park: ParkData | undefined
    if (snapshot.park?.kind === 'choices') {
      park = {
        kind: 'choices',
        choices: snapshot.park.choices.map((c) => ({ spans: c.spans, choice: decodeChoice(c.choice) })),
      }
    } else if (snapshot.park?.kind === 'input') {
      park = { kind: 'input', varName: snapshot.park.varName, placeholder: snapshot.park.placeholder }
    }
    restore = {
      entry: snapshot.entry,
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
      park,
      panels: snapshot.panels,
    }
  } catch (e) {
    return { ok: false, reason: 'corrupt', detail: (e as Error).message }
  }

  try {
    const story = new Story(program, { start: snapshot.current.knot, seed: RESTORE_SEED }, restore)
    return { ok: true, story }
  } catch (e) {
    // 构造期 buildGlobals 跑作者 preamble 抛 RuntimeError = 脚本坏，非存档坏。
    if (e instanceof RuntimeError) return { ok: false, reason: 'story-error', message: e.message }
    return { ok: false, reason: 'corrupt', detail: (e as Error).message }
  }
}
