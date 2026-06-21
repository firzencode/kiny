import type { Choice, ContentBlock, Knot } from '../parser/ast'
import type { ValidatedProgram } from '../analyze/types'
import type { Frame } from './frames'

/** 运行时状态快照：纯 JSON-able 数据，可落盘往返。 */
export interface StorySnapshot {
  version: 1
  fingerprint: string
  turns: number
  ended: boolean
  rng: number
  variantCounters: Record<string, number>
  visitedAt: Record<string, number>
  globals: Record<string, unknown>
  current: { knot: string; stitch?: string; localIsGlobal: boolean; locals?: Record<string, unknown> }
  taken: number[]
  stack: { path: BlockPath; index: number }[]
}

/** restoreStory 解码快照后交给 Story 构造的内部数据（含解析回的 AST 引用）。 */
export interface RestoreData {
  turns: number
  ended: boolean
  globals: Record<string, unknown>
  rng: number
  variantCounters: Record<string, number>
  visitedAt: Record<string, number>
  taken: Choice[]
  currentKnot: Knot
  currentStitch: string | null
  localIsGlobal: boolean
  locals?: Record<string, unknown>
  frames: Frame[]
}

/** 一个栈帧 block 的定位：根（knot.body 或 stitch.body）+ 逐层下钻步骤。 */
export type BlockPath = {
  root: { knot: string; stitch?: string }
  steps: { via: number; pick: { choice: number } | { branch: number } }[]
}

/** 给 program 里每个 block（knot/stitch/choice/branch 的 body）建立 引用 → 路径 映射。 */
export function buildBlockPaths(program: ValidatedProgram): Map<ContentBlock, BlockPath> {
  const map = new Map<ContentBlock, BlockPath>()
  const visit = (block: ContentBlock, path: BlockPath): void => {
    map.set(block, path)
    block.forEach((el, via) => {
      if (el.kind === 'choiceGroup') {
        el.choices.forEach((c, choice) => {
          visit(c.body, { root: path.root, steps: [...path.steps, { via, pick: { choice } }] })
        })
      } else if (el.kind === 'conditional') {
        el.branches.forEach((b, branch) => {
          visit(b.body, { root: path.root, steps: [...path.steps, { via, pick: { branch } }] })
        })
      }
    })
  }
  for (const f of program.files) {
    for (const k of f.knots) {
      visit(k.body, { root: { knot: k.name }, steps: [] })
      for (const s of k.stitches) visit(s.body, { root: { knot: k.name, stitch: s.name }, steps: [] })
    }
  }
  return map
}

/** 按路径从 program 下钻取回 block 引用；越界 / 类型不符抛 Error（restore 捕获为 corrupt）。 */
export function resolveBlock(program: ValidatedProgram, path: BlockPath): ContentBlock {
  let block: ContentBlock
  if (path.root.stitch !== undefined) {
    const st = program.stitches.get(path.root.knot)?.get(path.root.stitch)
    if (!st) throw new Error(`resolveBlock: stitch 不存在 ${path.root.knot}.${path.root.stitch}`)
    block = st.body
  } else {
    const k = program.knots.get(path.root.knot)
    if (!k) throw new Error(`resolveBlock: knot 不存在 ${path.root.knot}`)
    block = k.body
  }
  for (const step of path.steps) {
    const el = block[step.via]
    if (!el) throw new Error('resolveBlock: via 越界')
    if ('choice' in step.pick) {
      if (el.kind !== 'choiceGroup') throw new Error('resolveBlock: 期望 choiceGroup')
      const c = el.choices[step.pick.choice]
      if (!c) throw new Error('resolveBlock: choice 越界')
      block = c.body
    } else {
      if (el.kind !== 'conditional') throw new Error('resolveBlock: 期望 conditional')
      const b = el.branches[step.pick.branch]
      if (!b) throw new Error('resolveBlock: branch 越界')
      block = b.body
    }
  }
  return block
}

/**
 * 确定性枚举：按固定顺序（files 按 path 字典序 → 每 file.knots 声明序，含 stitches →
 * body 树深度优先）走遍 program 的所有 Choice，建立 序号 ↔ 节点 双向映射。
 * 序列化与反序列化共用本函数；指纹保证 program 一致 → 枚举顺序一致 → 序号两端对齐。
 */
export function enumerateChoices(program: ValidatedProgram): {
  list: Choice[]
  index: Map<Choice, number>
} {
  const list: Choice[] = []
  const walk = (block: ContentBlock): void => {
    for (const el of block) {
      if (el.kind === 'choiceGroup') {
        for (const c of el.choices) {
          list.push(c)
          walk(c.body)
        }
      } else if (el.kind === 'conditional') {
        for (const b of el.branches) walk(b.body)
      }
    }
  }
  const files = [...program.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const f of files) {
    for (const k of f.knots) {
      walk(k.body)
      for (const s of k.stitches) walk(s.body)
    }
  }
  const index = new Map<Choice, number>()
  list.forEach((c, i) => index.set(c, i))
  return { list, index }
}

/** djb2 字符串 hash，输出十六进制（无符号 32 位）。 */
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/**
 * 结构指纹：对枚举出的结构骨架（knot 名序列 + 各 choice 的结构特征）规范化串联后 hash。
 * 同一 program → 同一指纹；增删 choice / 改结构 → 指纹变化。
 */
export function fingerprint(program: ValidatedProgram): string {
  const parts: string[] = []
  const files = [...program.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const f of files) {
    parts.push(`F:${f.path}`)
    for (const k of f.knots) {
      parts.push(`K:${k.name}:${k.params.join(',')}`)
      for (const s of k.stitches) parts.push(`S:${s.name}`)
    }
  }
  for (const c of enumerateChoices(program).list) {
    parts.push(`C:${c.line}:${c.sticky ? 1 : 0}${c.fallback ? 1 : 0}:${c.label ?? ''}`)
  }
  return djb2(parts.join(''))
}
