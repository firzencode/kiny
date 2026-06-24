import type { ValidatedProgram } from '../analyze/types'
import { openingKnotName } from '../analyze'
import type {
  Choice,
  ChoiceGroup,
  Command,
  ContentElement,
  InlineSegment,
  Knot,
  Stitch,
} from '../parser/ast'
import { FrameStack, type Frame } from './frames'
import { evalExpr, makeScope, runStatement } from './env'
import type { Scope } from './env'
import { makeRng } from './rng'
import type { Rng } from './rng'
import { makeVariants } from './variants'
import type { Variants } from './variants'
import { RuntimeError } from './types'
import type { ChoiceView, OutputEvent, StoryOptions } from './types'
import type { RichSpan } from './spans'
import { makeTextSpan, mergeSpans } from './spans'
import { buildBlockPaths, enumerateChoices, fingerprint } from './snapshot'
import type { StorySnapshot, RestoreData } from './snapshot'

const STEP_BUDGET = 100_000
const DEFAULT_SEED = 0x9e3779b9

export class Story {
  private readonly stack = new FrameStack()
  private buffer: RichSpan[] | null = null
  private bufferGlued = false // buffer 末尾来自 glue 文本，待与后续内容粘连，不可 flush
  private ended = false
  private currentKnot!: Knot
  private currentStitch: string | null = null // 当前所在 stitch 名（栈根定位用，knot 顶层为 null）
  private currentFile?: string // 当前 knot 所属文件路径（错误源定位用）
  private readonly knotFile = new Map<string, string>() // knot 名 → 文件路径
  private readonly B: Scope = {} // 内置函数层：变体 / random / seed_random / turns / turns_since
  private readonly G: Scope = makeScope() // 全局
  private L: Scope | null = null // 当前节点局部作用域（每次进 knot 上下文重建）
  private readonly rng: Rng // 可复现 PRNG（变体 shuffle / random / seed_random 共用）
  private variants!: Variants // 变体内置 + 计数器 export/import（状态快照用）

  private readonly taken = new Set<Choice>() // 一次性已选（按节点身份）
  private pendingChoices: { view: ChoiceView; choice: Choice }[] = []
  private pendingDivert: { target: string; args: string[]; line: number } | null = null // 点击正文产出后待消费的跳转
  private turns = 0
  private readonly visitedAt = new Map<string, number>() // knot 名 → 最近访问回合
  private readonly start: string // 入口起点 knot 名（buildGlobals 据此跳过入口开场 preamble）

  constructor(
    private readonly program: ValidatedProgram,
    options: StoryOptions,
    restore?: RestoreData,
  ) {
    const knot = this.program.knots.get(options.start)
    if (!knot) throw new RuntimeError(`入口节点不存在：「${options.start}」`)
    this.start = options.start
    for (const f of this.program.files) {
      for (const k of f.knots) this.knotFile.set(k.name, f.path)
    }
    this.rng = makeRng(options.seed ?? DEFAULT_SEED)
    // 在 buildGlobals 之前填充内置层 B，使 preamble 逻辑也能用变体 / random / seed_random。
    // counters 存于 makeVariants 闭包内（Story 级持久），跨经过累积。
    this.variants = makeVariants(this.rng)
    Object.assign(this.B, this.variants.fns, {
      random: (min: number, max: number) => min + Math.floor(this.rng.next() * (max - min + 1)),
      seed_random: (n: number) => this.rng.reseed(n),
      turns: () => this.turns,
      turns_since: (name: string) =>
        this.visitedAt.has(name) ? this.turns - this.visitedAt.get(name)! : -1,
    })
    if (restore) {
      this.restoreFrom(restore)
      return
    }
    this.buildGlobals()
    // 标签计数初始化为 0
    for (const label of this.program.labels) {
      ;(this.G as Record<string, unknown>)[label] = 0
    }
    this.enterKnot(knot)
  }

  /** 从快照数据装配运行时状态（不跑 preamble / 不进 knot，直接覆盖各字段）。 */
  private restoreFrom(r: RestoreData): void {
    this.turns = r.turns
    this.ended = r.ended
    Object.assign(this.G, r.globals)
    this.rng.setState(r.rng)
    this.variants.importCounters(r.variantCounters)
    for (const [k, v] of Object.entries(r.visitedAt)) this.visitedAt.set(k, v)
    for (const c of r.taken) this.taken.add(c)
    this.currentKnot = r.currentKnot
    this.currentFile = this.knotFile.get(r.currentKnot.name)
    this.currentStitch = r.currentStitch
    this.L = r.localIsGlobal ? this.G : Object.assign(makeScope(), r.locals)
    if (!r.ended) {
      this.stack.restoreFrames(r.frames)
      // 栈顶 index 已回退指向触发选项的 choiceGroup；重跑一次推进以重建 pendingChoices。
      this.advanceToEvent()
    }
  }

  /**
   * 导出当前运行时状态为快照。仅在稳定边界（!canContinue：等待选择或已结束）可用，
   * 非边界抛 RuntimeError——调用方应先 continue() 推进到选项或结束再存档。
   */
  serialize(): StorySnapshot {
    if (this.canContinue) {
      throw new RuntimeError('serialize() 仅在稳定边界可用（等待选择或已结束）')
    }
    const blockPaths = buildBlockPaths(this.program)
    const { index: choiceIndex } = enumerateChoices(this.program)

    const frames = this.stack.snapshotFrames()
    const waitingChoice = !this.ended && this.pendingChoices.length > 0
    const stack = this.ended
      ? []
      : frames.map((f, i) => {
          const path = blockPaths.get(f.block)
          if (!path) throw new RuntimeError('serialize: 栈帧 block 无路径')
          // 停在选项时栈顶帧 index 已越过 choiceGroup 一格，回退指回它，
          // restore 后重跑 advanceToEvent 会重新 park 出同样的 pendingChoices。
          const index = waitingChoice && i === frames.length - 1 ? f.index - 1 : f.index
          return { path, index }
        })

    const taken: number[] = []
    this.taken.forEach((c) => {
      const n = choiceIndex.get(c)
      if (n !== undefined) taken.push(n)
    })
    taken.sort((a, b) => a - b)

    return {
      version: 1,
      fingerprint: fingerprint(this.program),
      turns: this.turns,
      ended: this.ended,
      rng: this.rng.state(),
      variantCounters: this.variants.exportCounters(),
      visitedAt: Object.fromEntries(this.visitedAt),
      globals: { ...this.G },
      current: {
        knot: this.currentKnot.name,
        ...(this.currentStitch !== null ? { stitch: this.currentStitch } : {}),
        localIsGlobal: this.L === this.G,
        ...(this.L === this.G ? {} : { locals: { ...this.L } }),
      },
      taken,
      stack,
    }
  }

  /** 启动时按文件名字典序执行各文件 preamble 的 ~ / ~~~ 建全局；跳过「起点正是其开场 knot」的文件（其 preamble 在进入开场 knot 时按序执行）。 */
  private buildGlobals(): void {
    const files = [...this.program.files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    )
    for (const f of files) {
      if (openingKnotName(f.path) === this.start) continue // 入口开场 knot 的 preamble 留待进入时按序执行
      for (const el of f.preamble) {
        if (el.kind === 'logicLine' || el.kind === 'logicBlock') {
          this.runLogic(el.code, true, f.path, el.line)
        }
      }
    }
  }

  /** 执行一段逻辑（~ / ~~~）：global 时导出到 G，否则导出到当前节点局部 L。 */
  private runLogic(code: string, global: boolean, file?: string, line?: number): void {
    try {
      runStatement(code, this.B, this.G, global ? null : this.L)
    } catch (e) {
      throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, file, line)
    }
  }

  get hasEnded(): boolean {
    return this.ended
  }

  /** 当前可呈现的选项。 */
  get currentChoices(): ChoiceView[] {
    return this.pendingChoices.map((p) => p.view)
  }

  get canContinue(): boolean {
    // 已有完整成行的待 flush 文本（点击正文 / 非 glue 行 / END 前定型的末段）。
    // 注意：此判断须先于 ended 短路——到达 END 时末段缓冲已定型成行（bufferGlued 清零），
    // 仍要报告可继续以便 flush 出最后一行。
    if (this.buffer !== null && !this.bufferGlued) return true
    if (this.ended) return false
    this.advanceToEvent()
    if (this.buffer !== null && !this.bufferGlued) return true
    if (this.parkedCommand() !== null) return true // 停在命令，下次 continue 产出 command 事件
    if (this.pendingChoices.length > 0) return false // 停在选项，让玩家选
    return !this.ended
  }

  /** 栈顶游标是否停在一个待产出的命令元素（advanceToEvent 在命令硬边界停下）。 */
  private parkedCommand(): Command | null {
    const frame = this.stack.current
    if (!frame) return null
    const el = frame.block[frame.index]
    return el && el.kind === 'command' ? el : null
  }

  /** 缓冲非空则定型成行（清 glue 标记）并返回 true，表示有完整行待 continue() flush。 */
  private settleBufferIntoLine(): boolean {
    if (this.buffer === null) return false
    this.bufferGlued = false
    return true
  }

  /**
   * 把富文本 spans 追加进文本缓冲（glue 跨行时归并边界），并设定本次写入是否为 glue 开口（待与后续粘连）。
   * 唯一的 (buffer, bufferGlued) 写点，确保每次写都同步维护 glue 标记。
   */
  private appendSpans(spans: RichSpan[], glue: boolean): void {
    this.buffer = mergeSpans(this.buffer ?? [], spans)
    this.bufferGlued = glue
  }

  continue(): OutputEvent {
    if (!this.canContinue) throw new RuntimeError('continue() 在 !canContinue 时被调用')
    // 文本统一经缓冲产出：canContinue 为真且 buffer 成行时，优先 flush 文本。
    if (this.buffer !== null) {
      const t = this.buffer
      this.buffer = null
      this.bufferGlued = false
      return { kind: 'text', spans: t }
    }
    // buffer 空：取 parked 元素产出事件（当前唯一 park 即命令）。
    const cmd = this.parkedCommand()
    if (cmd === null) {
      throw new RuntimeError('internal: canContinue 为真但无可产出事件')
    }
    const ev = this.step(cmd, this.stack.current!)
    if (ev === null) {
      throw new RuntimeError('internal: 命令 step 未产出事件')
    }
    return ev
  }

  choose(index: number): void {
    if (this.pendingChoices.length === 0) {
      throw new RuntimeError('当前无待选选项')
    }
    if (index < 0 || index >= this.pendingChoices.length) {
      throw new RuntimeError(`choose 越界：${index}`)
    }
    const entry = this.pendingChoices[index]!
    this.pendingChoices = []
    this.turns++
    const ev = this.takeChoice(entry.choice)
    // 点击正文追加进 buffer（与文本缓冲统一），成行（非 glue）下次 continue flush。
    if (ev && ev.kind === 'text') this.appendSpans(ev.spans, false)
  }

  /** 进入一个新的 knot 上下文：切 currentKnot、建全新节点局部作用域 L、记录访问回合。 */
  private switchKnot(knot: Knot): void {
    this.currentKnot = knot
    this.currentFile = this.knotFile.get(knot.name)
    this.L = knot.scope === 'global' ? this.G : makeScope()
    this.visitedAt.set(knot.name, this.turns)
  }

  /** 进入节点正文：换 knot 上下文（新建局部作用域 L），并以其 body 为唯一根帧。 */
  private enterKnot(knot: Knot): void {
    this.switchKnot(knot)
    this.stack.reset(knot.body)
    this.currentStitch = null
  }

  /** 进入子节点正文：以其 body 为唯一根帧。currentKnot 由调用方按需先设好。 */
  private enterStitch(stitch: Stitch): void {
    this.stack.reset(stitch.body)
    this.currentStitch = stitch.name
  }

  /**
   * 推进栈直到栈顶指向一个「会产出事件」的元素，或结束。
   * 无产出元素（divert/logic 等）就地执行。
   */
  private advanceToEvent(): void {
    let steps = 0
    for (;;) {
      if (++steps > STEP_BUDGET) throw new RuntimeError('疑似死循环：步数超预算')
      if (this.ended) {
        // 显式 -> END/DONE 到达时若仍有缓冲（含末段 glue 文本），先定型成行
        // 交 continue() flush，绝不静默丢弃；缓冲为空时定型为 no-op，照常退出。
        this.settleBufferIntoLine()
        return
      }
      // 完整成行的文本停下交给 continue flush；glue 文本（开口）继续累积。
      if (this.buffer !== null && !this.bufferGlued) return
      // 消费待处理的跳转。点击正文（非 glue）已先 flush；glue 文本跨跳转继续累积。
      if (this.pendingDivert !== null) {
        const pd = this.pendingDivert
        this.pendingDivert = null
        this.doDivert(pd.target, pd.args, pd.line)
        continue
      }
      if (this.pendingChoices.length > 0) {
        // 呈现选项前先 flush 缓冲（含开口的 glue 文本，此处定型成行）；
        // 无缓冲则停在选项，让玩家选。
        this.settleBufferIntoLine()
        return
      }
      this.settle()
      const frame = this.stack.current
      if (!frame) {
        // 栈空：先 flush 缓冲再结束（含开口 glue 文本定型成行）。
        if (this.settleBufferIntoLine()) return
        this.ended = true
        return
      }
      const el = frame.block[frame.index]!
      if (el.kind === 'text') {
        // 文本就地累积进 buffer；glue 则继续合并，否则成行（下一轮顶部 flush）。
        this.appendSpans(this.renderSpans(el.segments, el.line), el.glue)
        frame.index++
        continue
      }
      if (el.kind === 'choiceGroup') {
        frame.index++ // 越过选项组：choose 后从其后汇合
        this.enterChoiceGroup(el)
        continue
      }
      if (el.kind === 'command') {
        // 命令是硬边界：缓冲非空先 flush 文本（含开口 glue，此处定型成行），命令留到下次推进；
        // 缓冲空则停在命令（不推进游标），由 continue() 经 step 产出 command 事件。
        this.settleBufferIntoLine()
        return
      }
      // 无产出元素：就地执行
      this.step(el, frame)
    }
  }

  /**
   * 进入选项组：算可见选项。
   * - 有可见选项 → park 到 pendingChoices（advanceToEvent 据此停下）。
   * - 无可见但有 fallback → 自动走 fallback。
   * - 无可见无 fallback → 跳过、向后汇合。
   */
  private enterChoiceGroup(group: ChoiceGroup): void {
    const available = group.choices.filter(
      (c) => !c.fallback && (c.sticky || !this.taken.has(c)) && this.condOk(c),
    )
    if (available.length > 0) {
      this.pendingChoices = available.map((c, i) => ({
        view: { spans: this.renderSpans([...c.before, ...(c.inner ?? [])], c.line), index: i },
        choice: c,
      }))
      return
    }
    const fb = group.choices.find((c) => c.fallback)
    if (fb) {
      // fallback 选项无 before/after/inner（parser 保证），takeChoice 必返回 null；
      // 它只负责设置 pendingDivert/body，由 advanceToEvent 继续推进。
      this.takeChoice(fb)
    }
    // 无可见无 fallback：什么都不做，advanceToEvent 继续向后推进汇合
  }

  /** 求值一个条件表达式片段（@if/@elif/选项条件），出错包成带源定位的 RuntimeError。 */
  private evalCondition(code: string, line: number): unknown {
    try {
      return evalExpr(code, this.B, this.G, this.L, `${this.currentKnot.name}:cond${line}`)
    } catch (e) {
      throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, this.currentFile, line)
    }
  }

  /** 选项条件求值；null 视为无条件。 */
  private condOk(c: Choice): boolean {
    return c.condition === null ? true : Boolean(this.evalCondition(c.condition, c.line))
  }

  /**
   * 选中一个选项：标记一次性已选、标签计数 +1，渲染点击正文（before+after）。
   * 有 body → push body（Task 6 验证汇合）；否则用 resultDivert。
   * 返回点击正文 text 事件（空串则返回 null）。
   */
  private takeChoice(c: Choice): OutputEvent | null {
    if (!c.sticky) this.taken.add(c)
    if (c.label !== null) {
      const g = this.G as Record<string, unknown>
      g[c.label] = ((g[c.label] as number) ?? 0) + 1
    }
    const narrative = this.renderSpans([...c.before, ...c.after], c.line)
    if (c.body.length > 0) {
      this.stack.push(c.body)
    } else if (c.resultDivert !== null) {
      this.pendingDivert = {
        target: c.resultDivert.target,
        args: c.resultDivert.args,
        line: c.resultDivert.line,
      }
    }
    return narrative.length === 0 ? null : { kind: 'text', spans: narrative }
  }

  /** 弹掉所有已耗尽的栈顶帧，使 current 指向真正可执行的元素或栈空。 */
  private settle(): void {
    let f = this.stack.current
    while (f && f.index >= f.block.length) {
      this.stack.pop()
      f = this.stack.current
    }
  }

  /** 执行单个元素：产出事件返回之，无产出返回 null。游标自增由各分支负责。 */
  private step(el: ContentElement, frame: Frame): OutputEvent | null {
    switch (el.kind) {
      case 'text': {
        // 文本统一在 advanceToEvent 内就地累积进 buffer，不应再经 step 产出。
        throw new RuntimeError('internal: text 元素不应经 step 产出（应走 buffer 累积）')
      }
      case 'divert': {
        frame.index++
        return this.doDivert(el.target, el.args, el.line)
      }
      case 'logicLine':
      case 'logicBlock': {
        frame.index++
        this.runLogic(el.code, false, undefined, el.line)
        return null
      }
      case 'conditional': {
        frame.index++ // 越过整个 @if 链；命中分支体耗尽后弹栈即汇合到此后
        for (const b of el.branches) {
          const ok = b.condition === null ? true : Boolean(this.evalCondition(b.condition, b.line))
          if (ok) {
            this.stack.push(b.body)
            break
          }
        }
        return null
      }
      case 'command': {
        frame.index++
        const args = el.args.map((a) => {
          try {
            return evalExpr(a, this.B, this.G, this.L, `${this.currentKnot.name}:cmdarg${el.line}`)
          } catch (e) {
            throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, this.currentFile, el.line)
          }
        })
        return { kind: 'command', name: el.name, args }
      }
      case 'choiceGroup': {
        // 选项组在 advanceToEvent 内处理（enterChoiceGroup），不应经 step。
        throw new RuntimeError('internal: choiceGroup 不应经 step 产出（应走 enterChoiceGroup）')
      }
    }
  }

  /**
   * 跳转：解析目标并重置帧栈（丢弃所有子帧）。
   * - END/DONE → 结束。
   * - 父.子 → 进该 stitch（parent 须为已知 knot、child 须为其 stitch）。
   * - 无 . → 先查全局 knot，未命中再查当前 knot 同级 stitch。
   * 均未命中则抛 RuntimeError。
   */
  private doDivert(target: string, args: string[] = [], line = 0): OutputEvent | null {
    if (target === 'END' || target === 'DONE') {
      this.ended = true
      return null
    }
    const dot = target.indexOf('.')
    if (dot !== -1) {
      const parent = target.slice(0, dot)
      const child = target.slice(dot + 1)
      const knot = this.program.knots.get(parent)
      const stitch = this.program.stitches.get(parent)?.get(child)
      if (!knot || !stitch) throw new RuntimeError(`跳转目标不存在：「${target}」`)
      this.switchKnot(knot) // 跨 knot：换新 L、记访问
      this.enterStitch(stitch)
      return null
    }
    const knot = this.program.knots.get(target)
    if (knot) {
      // 实参在旧 env（源节点的 L/currentKnot）求值，再 enterKnot 换新 L，再绑定到新 L。
      const values = args.map((a) => {
        try {
          return evalExpr(a, this.B, this.G, this.L, `${this.currentKnot.name}:arg${line}`)
        } catch (e) {
          throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, this.currentFile, line)
        }
      })
      this.enterKnot(knot)
      knot.params.forEach((p, i) => {
        ;(this.L as Record<string, unknown>)[p] = values[i]
      })
      return null
    }
    const sibling = this.program.stitches.get(this.currentKnot.name)?.get(target)
    if (sibling) {
      this.enterStitch(sibling)
      return null
    }
    throw new RuntimeError(`跳转目标不存在：「${target}」`)
  }

  /**
   * 渲染行内片段为富文本 spans：literal 取 value + 其 style；interp 段求值转串（null/undefined→空串）
   * 并承继其 style；break → 换行 span。空文本段不产 span；相邻同样式文本段归并（纯文本恒为单 span）。
   * `line` 为片段所在行（TextLine.line / Choice.line），出错时透传给 RuntimeError 定位。
   */
  private renderSpans(segments: InlineSegment[], line = 0): RichSpan[] {
    const raw: RichSpan[] = []
    for (const seg of segments) {
      if (seg.kind === 'break') {
        raw.push({ kind: 'break' })
        continue
      }
      let text: string
      if (seg.kind === 'literal') text = seg.value
      else {
        let v: unknown
        try {
          v = evalExpr(seg.code, this.B, this.G, this.L, `${this.currentKnot.name}:i${seg.id}`)
        } catch (e) {
          throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, this.currentFile, line)
        }
        text = v === undefined || v === null ? '' : String(v)
      }
      if (text === '') continue
      raw.push(makeTextSpan(text, seg.style))
    }
    return mergeSpans([], raw) // 经 coalesce 归并相邻同样式段
  }
}
