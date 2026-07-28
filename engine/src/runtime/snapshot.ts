import type { Choice, ContentBlock, Knot } from '../parser/ast'
import type { ValidatedProgram } from '../analyze/types'
import { openingKnotName } from '../analyze'
import { sortByPath } from '../order'
import { visitBlockTree, type BlockVisitor } from '../parser/visit'
import type { Frame } from './frames'
import type { RichSpan } from './spans'

/**
 * program 的全部 knot（**含合成开场 knot**），确定性顺序：文件按 path 字典序，每文件先开场 knot
 * 后具名 knot（声明序）。开场 knot 在 `program.knots` Map 里、不在 `file.knots`，故枚举 / 建路径 /
 * 指纹都须经此辅助一并覆盖——否则顶层开场（首个 `===` 前）的选项点 serialize 会「栈帧 block 无路径」。
 */
function orderedKnots(program: ValidatedProgram): Knot[] {
  const files = sortByPath(program.files)
  const out: Knot[] = []
  for (const f of files) {
    const opening = program.knots.get(openingKnotName(f.path))
    if (opening) out.push(opening)
    for (const k of f.knots) out.push(k)
  }
  return out
}

/**
 * park 态的**已求值结果**（落盘形态，choice 存 enumerateChoices 序号）：restore 直接重建 park 态，
 * 不重跑 enterChoiceGroup / evalArg——彻底消除 A2「restore 重放选项/输入求值副作用」。ended 时缺省。
 */
export type ParkSnapshot =
  | { kind: 'choices'; choices: { spans: RichSpan[]; choice: number }[] }
  | { kind: 'input'; varName: string; placeholder: string | null }

/** 运行时状态快照：纯 JSON-able 数据，可落盘往返。 */
export interface StorySnapshot {
  version: 4
  fingerprint: string
  entry: string // 原始入口起点 knot 名（= 建 Story 时的 start）：restore 据此复刻正常播放的 buildGlobals 顺序
  turns: number
  ended: boolean
  rng: number
  variantCounters: Record<string, number>
  visitedAt: Record<string, number>
  globals: Record<string, unknown>
  current: { knot: string; stitch?: string; localIsGlobal: boolean; locals?: Record<string, unknown> }
  taken: number[]
  stack: { path: BlockPath; index: number }[] // index 存真实游标值（park 于选项时亦不回退）
  park?: ParkSnapshot // 新增；ended 时缺省
  /**
   * `@panel` 已登记的活模板**本体**（槽位 → 模板源串）；无面板时缺省。
   * 只存模板不存求值结果——restore 后重登记、首次重估必发事件，读档即渲染出当前值。
   */
  panels?: Record<string, string>
}

/** park 态解码结果（choice 序号已解回 AST 引用），交 Story 直接重建 pendingChoices / pendingInput。 */
export type ParkData =
  | { kind: 'choices'; choices: { spans: RichSpan[]; choice: Choice }[] }
  | { kind: 'input'; varName: string; placeholder: string | null }

/** restoreStory 解码快照后交给 Story 构造的内部数据（含解析回的 AST 引用）。 */
export interface RestoreData {
  entry: string // 原始入口起点 knot 名：restore 复刻正常播放的 buildGlobals 顺序（见 story.ts buildGlobals）
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
  park?: ParkData // park 态已求值结果；ended 时缺省
  panels?: Record<string, string> // `@panel` 活模板本体（槽位 → 模板源串）
}

/** 一个栈帧 block 的定位：根（knot.body 或 stitch.body）+ 逐层下钻步骤。 */
export type BlockPath = {
  root: { knot: string; stitch?: string }
  steps: { via: number; pick: { choice: number } | { branch: number } }[]
}

// program 是 analyze 产出的不可变结构，故 buildBlockPaths / enumerateChoices / fingerprint 的结果
// 只随 program 身份变化。按 program 引用 WeakMap 缓存（program 释放即随之 GC，无泄漏），把 reader
// 每回合自动存档的 O(全书) 重建降为 O(1) 摊销（C1）。返回值按**只读**契约使用（现有调用方仅做查表 /
// 比较，不改动返回的 Map/数组）——如需修改务必先拷贝，否则会污染缓存。
const blockPathsCache = new WeakMap<ValidatedProgram, Map<ContentBlock, BlockPath>>()
const choicesCache = new WeakMap<ValidatedProgram, { list: Choice[]; index: Map<Choice, number> }>()
const fingerprintCache = new WeakMap<ValidatedProgram, string>()

/** 给 program 里每个 block（knot/stitch/choice/branch 的 body）建立 引用 → 路径 映射（按 program 缓存）。 */
export function buildBlockPaths(program: ValidatedProgram): Map<ContentBlock, BlockPath> {
  const cached = blockPathsCache.get(program)
  if (cached) return cached
  const map = new Map<ContentBlock, BlockPath>()
  // 语境 = 到当前 block 的路径；下钻 choice/branch 时在 steps 尾追一步（via = 所在元素下标）。
  const pather: BlockVisitor<BlockPath> = {
    block: (block, path) => map.set(block, path),
    choice: (_c, via, index, path) => ({ root: path.root, steps: [...path.steps, { via, pick: { choice: index } }] }),
    branch: (_b, via, index, path) => ({ root: path.root, steps: [...path.steps, { via, pick: { branch: index } }] }),
  }
  for (const k of orderedKnots(program)) {
    visitBlockTree(k.body, { root: { knot: k.name }, steps: [] }, pather)
    for (const s of k.stitches) visitBlockTree(s.body, { root: { knot: k.name, stitch: s.name }, steps: [] }, pather)
  }
  blockPathsCache.set(program, map)
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
  const cached = choicesCache.get(program)
  if (cached) return cached
  const list: Choice[] = []
  // choice 钩子的触发顺序即枚举序：每个 choice 先入表、再下钻其 body（深度优先），与旧手写递归逐字一致。
  const collector: BlockVisitor<null> = { choice: (c) => (list.push(c), null) }
  for (const k of orderedKnots(program)) {
    visitBlockTree(k.body, null, collector)
    for (const s of k.stitches) visitBlockTree(s.body, null, collector)
  }
  const index = new Map<Choice, number>()
  list.forEach((c, i) => index.set(c, i))
  const result = { list, index }
  choicesCache.set(program, result)
  return result
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
  const cached = fingerprintCache.get(program)
  if (cached !== undefined) return cached
  const parts: string[] = []
  const files = sortByPath(program.files)
  for (const f of files) {
    parts.push(`F:${f.path}`)
    for (const k of f.knots) {
      parts.push(`K:${k.name}:${k.params.join(',')}`)
      for (const s of k.stitches) parts.push(`S:${s.name}`)
    }
  }
  // choice 用**结构序号**（enumerateChoices 的确定性枚举位序，即 parts 里的出现顺序）+ 结构特征，
  // 不编入源码行号 c.line（T069 决策 A11）：在 choice 前插 / 删一行（哪怕注释）不再令全部旧存档失效；
  // 增删 / 重排 choice 仍改变序列 → 指纹变。指纹是启发式兼容护栏、非正确性保证（改逻辑不改指纹属固有，
  // 由 restore 正确性另行保障）。
  enumerateChoices(program).list.forEach((c, i) => {
    parts.push(`C:${i}:${c.sticky ? 1 : 0}${c.fallback ? 1 : 0}:${c.label ?? ''}`)
  })
  const fp = djb2(parts.join('\u0001'))
  fingerprintCache.set(program, fp)
  return fp
}
