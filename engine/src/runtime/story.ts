import type { ValidatedProgram } from '../analyze/types'
import { openingKnotName } from '../analyze'
import type {
  Choice,
  ChoiceGroup,
  Command,
  ContentElement,
  InlineSegment,
  Knot,
  PauseKind,
  ProjectFile,
  Stitch,
} from '../parser/ast'
import { FrameStack, type Frame } from './frames'
import { evalExpr, makeScope, runStatement } from './env'
import type { Scope } from './env'
import { makeRng, GOLDEN_SEED } from './rng'
import type { Rng } from './rng'
import { makeVariants } from './variants'
import type { Variants } from './variants'
import { RuntimeError, PANEL_SLOTS } from './types'
import type { ChoiceView, OutputEvent, StoryOptions, PanelSlot } from './types'
import type { RichSpan } from './spans'
import { makeTextSpan, mergeSpans, sameSpans } from './spans'
import { scanInline } from '../parser/inline'
import { buildBlockPaths, enumerateChoices, fingerprint } from './snapshot'
import type { StorySnapshot, RestoreData, ParkSnapshot } from './snapshot'
import { encodeGlobals, decodeGlobals } from './scope-codec'
import { makeNodes, nodeRefData } from './node-ref'
import type { Nodes } from './node-ref'
import { sortByPath } from '../order'

// 无玩家交互的累计自动推进步数上限（仅 choose() 清零）。取值是「尽早报错」与
// 「不误伤合法长自动段」的折中：互动小说两次交互间极少处理上万个内容元素，
// 故 1 万足够安全，同时让无停顿环远早于 reader 堆积海量日志前就抛错。
const STEP_BUDGET = 10_000
const DEFAULT_SEED = GOLDEN_SEED

/**
 * 按换行切文本（`\r\n` / `\r` 先归一为 `\n`，免残留 `\r` 成为不可见怪字符）。
 * 返回的段与换行**交替**，首尾不修剪——写几个换行就换几行（`"行\n"` → `['行', '']`，段末那个空段
 * 意味着一处 break）。归一化在此收口，调用方只需在段间插 break。
 */
function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

export class Story {
  private readonly stack = new FrameStack()
  private buffer: RichSpan[] | null = null
  private bufferGlued = false // buffer 末尾来自 glue 文本，待与后续内容粘连，不可 flush
  private canContinueCache: boolean | null = null // canContinue 幂等缓存（B2）；推进后失效，null=未算
  private ended = false
  private currentKnot!: Knot
  private currentStitch: string | null = null // 当前所在 stitch 名（栈根定位用，knot 顶层为 null）
  private currentFile?: string // 当前 knot 所属文件路径（错误源定位用）
  private readonly knotFile = new Map<string, string>() // knot 名 → 文件路径
  private readonly B: Scope = makeScope() // 内置函数层：变体 / random / seed_random / turns / turns_since（与 G/L 一致用 null 原型，避免 Object.prototype 泄进脚本作用域）
  private readonly G: Scope = makeScope() // 全局
  private L: Scope | null = null // 当前节点局部作用域（每次进 knot 上下文重建）
  private readonly rng: Rng // 可复现 PRNG（变体 shuffle / random / seed_random 共用）
  private variants!: Variants // 变体内置 + 计数器 export/import（状态快照用）

  private readonly taken = new Set<Choice>() // 一次性已选（按节点身份）
  private pendingChoices: { view: ChoiceView; choice: Choice }[] = []
  private pendingInput: { varName: string; placeholder: string | null } | null = null // 停在 @input：等读者提交文本（与 pendingChoices 对偶）
  private pendingDivert: { target: string; args: string[]; targetExpr?: string; line: number } | null = null // 点击正文产出后待消费的跳转
  /**
   * `@panel` 登记的活模板：槽位 → 模板源串 + 已解析段 + 上次重估结果。
   * 模板本体入快照（读档重登记）；`last` 不入——读档后首次重估必发事件，宿主据此立刻渲染。
   */
  private readonly panels = new Map<PanelSlot, { source: string; segments: InlineSegment[]; line: number; last: RichSpan[] | null }>()
  private pendingPanelEvents: OutputEvent[] = [] // 重估出的待产出 panel 事件（先进先出）
  private readonly nodes: Nodes // $nodes 节点表（B 层注入 + 存档 revive）
  private turns = 0
  private autoSteps = 0 // 自上次玩家交互(choose)起的累计自动推进步数；死循环兜底用
  private readonly visitedAt = new Map<string, number>() // knot 名 → 最近访问回合
  private readonly start: string // 入口起点 knot 名（buildGlobals 据此跳过入口开场 preamble）

  constructor(
    private readonly program: ValidatedProgram,
    options: StoryOptions,
    restore?: RestoreData,
  ) {
    const knot = this.program.knots.get(options.start)
    if (!knot) throw new RuntimeError(`入口节点不存在：「${options.start}」`)
    // restore 时 options.start 传的是快照**当前**所在 knot（仅供上面的存在性校验），真正的入口起点是
    // 原始 entry——须记为 this.start，否则 restored 故事再存档时 serialize 会把 entry 写成当前 knot，
    // 下次读档便丢失「入口开场文件 preamble 最后跑」的顺序，跨文件读依赖会误抛（见 buildGlobals）。
    this.start = restore ? restore.entry : options.start
    for (const f of this.program.files) {
      for (const k of f.knots) this.knotFile.set(k.name, f.path)
    }
    this.rng = makeRng(options.seed ?? DEFAULT_SEED)
    // 在 buildGlobals 之前填充内置层 B，使 preamble 逻辑也能用变体 / random / seed_random。
    // counters 存于 makeVariants 闭包内（Story 级持久），跨经过累积。
    this.variants = makeVariants(this.rng)
    this.nodes = makeNodes(this.program.knots, this.program.stitches)
    Object.assign(this.B, this.variants.fns, {
      random: (min: number, max: number) => min + Math.floor(this.rng.next() * (max - min + 1)),
      seed_random: (n: number) => this.rng.reseed(n),
      turns: () => this.turns,
      turns_since: (name: string) =>
        this.visitedAt.has(name) ? this.turns - this.visitedAt.get(name)! : -1,
      $nodes: this.nodes.root,
    })
    // buildGlobals + 标签初始化在两条路径都跑（this.start 此时已是真正的入口起点，两路一致）。正常启动
    // 跳过入口开场 knot 所属文件（其 preamble 留待进入开场 knot 时按序执行、即最后跑）。restore 无
    // enterKnot 兜底，须自行补跑该文件的 preamble 以重建其函数（A4），且 deferSkipped=true 让它**最后**
    // 跑——复刻正常播放的建全局顺序，避免入口文件 preamble 读取的跨文件全局在 restore 早跑时尚未就绪而误抛。
    this.buildGlobals(this.start, restore !== undefined)
    // 标签计数初始化为 0
    for (const label of this.program.labels) {
      ;(this.G as Record<string, unknown>)[label] = 0
    }
    if (restore) {
      this.restoreFrom(restore)
      return
    }
    this.enterKnot(knot)
  }

  /**
   * 从快照数据装配运行时状态：buildGlobals 已重建 preamble 声明的函数并跑出初值，本函数用快照
   * 覆盖可序列化状态（globals / rng / 计数器等），并直接重建 park 态——不重跑 advanceToEvent，
   * 故选项/输入的求值副作用（变体推进、rng 消耗、条件里改全局）不会被重放（A2）。
   */
  private restoreFrom(r: RestoreData): void {
    this.turns = r.turns
    this.ended = r.ended
    const revive = (p: string, a?: unknown[]) => this.nodes.revive(p, a) // Node 标签经 $nodes 同一工厂重建（节点已删则抛普通 Error → restore 判 corrupt）
    Object.assign(this.G, decodeGlobals(r.globals, revive)) // 覆盖可序列化全局数据（先 decode 还原 Map/Set/Date/Node）；函数已由 buildGlobals 重建、不在 r.globals 里
    this.rng.setState(r.rng) // 覆盖 buildGlobals 重跑 preamble 消耗掉的 rng 状态
    this.variants.importCounters(r.variantCounters) // 同理覆盖变体计数
    for (const [k, v] of Object.entries(r.visitedAt)) this.visitedAt.set(k, v)
    for (const c of r.taken) this.taken.add(c)
    this.currentKnot = r.currentKnot
    this.currentFile = this.knotFile.get(r.currentKnot.name)
    this.currentStitch = r.currentStitch
    this.L = r.localIsGlobal ? this.G : Object.assign(makeScope(), decodeGlobals(r.locals ?? {}, revive))
    if (!r.ended) {
      this.stack.restoreFrames(r.frames)
      // 直接重建 park 态（park 快照存的是已求值结果），不调 advanceToEvent——A2 的修复核心。
      if (r.park?.kind === 'choices') {
        this.pendingChoices = r.park.choices.map((c, i) => ({
          view: { spans: c.spans, index: i },
          choice: c.choice, // 已由 restoreStory 解码回 AST 引用
        }))
      } else if (r.park?.kind === 'input') {
        this.pendingInput = { varName: r.park.varName, placeholder: r.park.placeholder }
      }
    }
    // 重登记活模板（只存了本体）：`last` 留 null → 首次重估必发事件，读档即渲染出当前值。
    for (const [slot, source] of Object.entries(r.panels ?? {})) {
      if (!(PANEL_SLOTS as readonly string[]).includes(slot)) continue // 未知槽位（跨版本存档）：忽略
      // 与 registerPanel 同构解析（含剥离 <pause>）——否则读档后含 <pause> 的模板会与现场播放分叉。
      this.panels.set(slot as PanelSlot, { source, segments: this.parsePanelTemplate(source, 0), line: 0, last: null })
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
    // 栈帧 index 存真实游标值（停在选项时栈顶已越过 choiceGroup 一格，不回退）——
    // restore 直接从 park 快照重建 pendingChoices，不再重跑 advanceToEvent。
    const stack = this.ended
      ? []
      : frames.map((f) => {
          const path = blockPaths.get(f.block)
          if (!path) throw new RuntimeError('serialize: 栈帧 block 无路径')
          return { path, index: f.index }
        })

    const taken: number[] = []
    this.taken.forEach((c) => {
      const n = choiceIndex.get(c)
      if (n !== undefined) taken.push(n)
    })
    taken.sort((a, b) => a - b)

    // park 态导出已求值结果（选项富文本 + 序号 / 输入 placeholder），不存重跑所需的游标位。
    let park: ParkSnapshot | undefined
    if (!this.ended) {
      if (this.pendingChoices.length > 0) {
        park = {
          kind: 'choices',
          choices: this.pendingChoices.map((p) => {
            const n = choiceIndex.get(p.choice)
            if (n === undefined) throw new RuntimeError('serialize: pendingChoice 无序号')
            return { spans: p.view.spans, choice: n }
          }),
        }
      } else if (this.pendingInput !== null) {
        park = { kind: 'input', varName: this.pendingInput.varName, placeholder: this.pendingInput.placeholder }
      }
    }

    // 活模板只存**本体**（槽位 → 源串）：restore 重登记，首次重估必发事件 → 读档即渲染出当前值。
    const panels: Record<string, string> = {}
    for (const [slot, p] of this.panels) panels[slot] = p.source

    return {
      version: 4,
      fingerprint: fingerprint(this.program),
      entry: this.start,
      turns: this.turns,
      ended: this.ended,
      rng: this.rng.state(),
      variantCounters: this.variants.exportCounters(),
      visitedAt: Object.fromEntries(this.visitedAt),
      globals: encodeGlobals(this.G), // 白名单容器编码：Map/Set/Date 保真；函数丢弃、由 buildGlobals 重建
      current: {
        knot: this.currentKnot.name,
        ...(this.currentStitch !== null ? { stitch: this.currentStitch } : {}),
        localIsGlobal: this.L === this.G,
        ...(this.L === this.G ? {} : { locals: encodeGlobals(this.L!) }), // 局部作用域同样编码
      },
      taken,
      stack,
      ...(park ? { park } : {}),
      ...(Object.keys(panels).length > 0 ? { panels } : {}),
    }
  }

  /**
   * 按文件名字典序执行各文件 preamble 的 ~ / ~~~ 建全局（含声明其函数）。
   * `skipOpeningOf` 给定时跳过「其开场 knot 名 === skipOpeningOf」的文件（入口开场 knot 所属文件）。
   * - 正常启动（`deferSkipped=false`）：被跳过的文件不在此跑，其 preamble 留待 enterKnot 进入开场 knot
   *   时按序执行（即最后跑），避免二次执行。
   * - restore（`deferSkipped=true`）：无 enterKnot 兜底，被跳过的文件改为**最后**补跑（restoreFrom 不调
   *   enterKnot，故不会二次执行），既重建其函数（A4），又与正常播放同序——入口文件 preamble 读取的
   *   跨文件全局在其他文件之后才求值，不会因 restore 早跑（字典序靠前）而未就绪误抛。
   */
  private buildGlobals(skipOpeningOf?: string, deferSkipped = false): void {
    const files = sortByPath(this.program.files)
    const deferred: ProjectFile[] = []
    for (const f of files) {
      if (skipOpeningOf !== undefined && openingKnotName(f.path) === skipOpeningOf) {
        if (deferSkipped) deferred.push(f) // restore：最后补跑；正常启动：交给 enterKnot
        continue
      }
      this.runFilePreamble(f)
    }
    for (const f of deferred) this.runFilePreamble(f)
  }

  /** 执行单个文件 preamble 里的逻辑元素（~ / ~~~）建全局；文本 / 跳转元素照常跳过。 */
  private runFilePreamble(f: ProjectFile): void {
    for (const el of f.preamble) {
      if (el.kind === 'logicLine' || el.kind === 'logicBlock') {
        this.runLogic(el.code, true, f.path, el.line)
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

  /** 当前待填的输入框（停在 @input 时非空；varName 为回写目标变量名，placeholder 为提示文字）。 */
  get currentInput(): { varName: string; placeholder: string | null } | null {
    return this.pendingInput
  }

  /**
   * 是否可继续推进（宿主 `while (story.canContinue)` 轮询）。**幂等只读缓存**（T069 决策 B2，修 A3）：
   * 同一位置重复读只算一次——首读 computeCanContinue（可能推进到下个事件、求值作者 JS），结果缓存；
   * 之后重复读返回缓存值、不再执行作者 JS / 不推进 / 不抛。真正的推进副作用只留在 `continue()` / `choose()`
   * / `submitInput()`——它们改变状态后 `invalidateCanContinue()` 失效缓存，下次读重新计算。
   */
  get canContinue(): boolean {
    if (this.canContinueCache === null) this.canContinueCache = this.computeCanContinue()
    return this.canContinueCache
  }

  /** 清缓存：状态推进（continue/choose/submitInput）后调，使下次读 canContinue 重新计算。 */
  private invalidateCanContinue(): void {
    this.canContinueCache = null
  }

  private computeCanContinue(): boolean {
    // 已有完整成行的待 flush 文本（点击正文 / 非 glue 行 / END 前定型的末段）。
    // 注意：此判断须先于 ended 短路——到达 END 时末段缓冲已定型成行（bufferGlued 清零），
    // 仍要报告可继续以便 flush 出最后一行。
    if (this.buffer !== null && !this.bufferGlued) return true
    if (this.pendingPanelEvents.length > 0) return true
    if (this.ended) {
      this.repanel() // 终局也重估一次：最后一步改的变量要反映到固定区域
      return this.pendingPanelEvents.length > 0
    }
    this.advanceToEvent()
    // 抵达一个事件边界（有行待 flush / park 命令 / park 选项 / park 输入 / 结束）——在此重估活模板。
    // 放这里而非 continue() 里：暂停点上宿主不会再调 continue()，重估必须由 canContinue 驱动，
    // 且本函数有幂等缓存（invalidateCanContinue 后才重算），不会对同一状态重复求值作者表达式。
    this.repanel()
    if (this.buffer !== null && !this.bufferGlued) return true
    if (this.pendingPanelEvents.length > 0) return true
    if (this.pendingInput !== null) return false // 停在输入框，等读者提交（与 pendingChoices 对偶，须先于 parkedCommand——@input 元素亦是 command）
    if (this.parkedCommand() !== null) return true // 停在命令，下次 continue 产出 command 事件
    if (this.pendingChoices.length > 0) return false // 停在选项，让玩家选
    return !this.ended
  }

  /**
   * engine 内部处理、**不透传**给宿主的命令：`@input`（park 成输入暂停）、`@panel`（登记活模板）。
   * 它们在 advanceToEvent 的循环里被消化，故不能被「停在命令 → 等 continue 产出 command 事件」的
   * 早退守卫拦下。
   */
  private static readonly INTERPRETED = new Set(['input', 'panel'])

  /** 栈顶游标是否停在一个待产出的命令元素（advanceToEvent 在命令硬边界停下）。 */
  private parkedCommand(): Command | null {
    const frame = this.stack.current
    if (!frame) return null
    const el = frame.block[frame.index]
    return el && el.kind === 'command' ? el : null
  }

  /**
   * 登记 / 替换一个槽的活模板（`@panel(槽位, 模板)`）。模板**登记时不求值**，只解析成段
   * （插值 + 富文本），求值发生在每次重估。再次对同槽登记 = 整体替换（buffer 整体改写语义）。
   */
  /**
   * 解析面板模板源串为段。模板里的 `<pause>` 无揭示流程可言，解析后直接丢掉段边界（spec：面板中忽略）
   * ——登记（registerPanel）与读档重登记（restoreFrom）**共用本函数**，两条路径产出同构的段。
   */
  private parsePanelTemplate(source: string, line: number): InlineSegment[] {
    return scanInline(source, 0, line, this.currentFile ?? '').segments.map((s) => {
      if (!('pauseBefore' in s) || !s.pauseBefore) return s
      const { pauseBefore: _drop, ...rest } = s
      return rest as InlineSegment
    })
  }

  private registerPanel(el: Command): void {
    const slot = String(this.evalArg(el.args[0]!, el.line))
    if (!(PANEL_SLOTS as readonly string[]).includes(slot)) {
      throw new RuntimeError(`未知的面板槽位「${slot}」`, this.currentFile, el.line)
    }
    const source = String(this.evalArg(el.args[1]!, el.line))
    this.panels.set(slot as PanelSlot, { source, segments: this.parsePanelTemplate(source, el.line), line: el.line, last: null })
  }

  /**
   * 重估全部活模板（每到一个事件边界调一次）：结果与上次不同才入队 `panel` 事件。
   * 模板表达式须**纯读取**——这里每步都会求值它们。
   */
  private repanel(): void {
    for (const slot of PANEL_SLOTS) {
      const p = this.panels.get(slot)
      if (!p) continue
      const spans = this.renderSpans(p.segments, p.line)
      if (sameSpans(p.last, spans)) continue
      p.last = spans
      this.pendingPanelEvents.push({ kind: 'panel', slot, spans })
    }
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
    this.invalidateCanContinue() // 本次将推进/产出状态，缓存作废（须在上面读过 canContinue 之后）
    // 文本统一经缓冲产出：canContinue 为真且 buffer 成行时，优先 flush 文本。
    if (this.buffer !== null) {
      const t = this.buffer
      this.buffer = null
      this.bufferGlued = false
      return { kind: 'text', spans: t }
    }
    // 固定区域更新排在正文之后：本行改的变量，其面板刷新紧跟该行出现。
    if (this.pendingPanelEvents.length > 0) return this.pendingPanelEvents.shift()!
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

  /**
   * 提交输入框文本（与 choose 对偶）：trim 后非空按 `~ varName = 文本` 的同一作用域规则回写，
   * 空 / 纯空白提交则不覆写（保留变量声明值作默认）。记一次玩家交互（turns++、autoSteps 清零），
   * 清 pendingInput、推进游标越过 @input、恢复推进。
   */
  submitInput(text: string): void {
    if (this.pendingInput === null) {
      throw new RuntimeError('当前无待填输入框')
    }
    this.invalidateCanContinue() // 提交输入 = 推进状态，canContinue 缓存作废
    const { varName } = this.pendingInput
    const v = text.trim()
    if (v !== '') {
      // 与逻辑行 `~ varName = v` 同一 L→G 作用域链回写，不必关心变量是全局还是局部。
      this.runLogic(`${varName} = ${JSON.stringify(v)}`, false)
    }
    this.turns++
    this.autoSteps = 0 // 玩家交互 = 取得进展，重置死循环兜底（防 @input 落循环里被 STEP_BUDGET 误伤）
    this.pendingInput = null
    const frame = this.stack.current
    if (frame) frame.index++ // 推进游标越过 @input 元素
    this.advanceToEvent()
  }

  choose(index: number): void {
    if (this.pendingChoices.length === 0) {
      throw new RuntimeError('当前无待选选项')
    }
    if (index < 0 || index >= this.pendingChoices.length) {
      throw new RuntimeError(`choose 越界：${index}`)
    }
    this.invalidateCanContinue() // 选择 = 推进状态，canContinue 缓存作废
    const entry = this.pendingChoices[index]!
    this.pendingChoices = []
    this.turns++
    this.autoSteps = 0 // 玩家交互 = 取得进展，重置死循环计数器
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
    if (this.pendingInput !== null) return // 已停在输入框：不再推进，等 submitInput（幂等，避免重复求值 placeholder）
    // 其余 park 态同样幂等早退：canContinue 是宿主每帧都可能轮询的 getter，停在选项/命令上
    // 反复调用不得累积 autoSteps 烧掉死循环预算（否则停留 1 万次轮询即被误判死循环）。
    if (this.pendingChoices.length > 0) {
      this.settleBufferIntoLine() // 与循环内 park 行为一致：残留 glue 缓冲定型成行交 continue flush
      return
    }
    const parked = this.parkedCommand()
    if (this.pendingDivert === null && parked !== null && !Story.INTERPRETED.has(parked.name)) {
      // 解释型命令（@input / @panel）例外：它们虽是 command 元素，但由循环内部消化
      //（park 成输入暂停 / 登记活模板后继续推进），不能在此当「待产出的透传命令」拦下。
      this.settleBufferIntoLine()
      return
    }
    for (;;) {
      if (++this.autoSteps > STEP_BUDGET) {
        throw new RuntimeError(
          `疑似死循环：在节点「${this.currentKnot?.name ?? '?'}」处无玩家交互地自动推进超过 ${STEP_BUDGET} 步`,
          this.currentFile,
        )
      }
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
        if (pd.targetExpr !== undefined) this.doDynamicDivert(pd.targetExpr, pd.line)
        else this.doDivert(pd.target, pd.args, pd.line)
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
        const spans = this.renderSpans(el.segments, el.line)
        // 空即无行（T069 决策 A8）：求值为空**且非 glue** 的独立行不成行（不产 text 事件、不建 buffer），
        // 免得 `{""}` / `{cond?"文字":""}` 假分支 / once 用尽等周期性产空白段。glue 守卫关键：glue 链中间
        // 的空插值（与前后文本拼一行）仍须 append 以维持 glue 开口、不误丢。
        if (spans.length > 0 || el.glue) this.appendSpans(spans, el.glue)
        frame.index++
        continue
      }
      if (el.kind === 'choiceGroup') {
        frame.index++ // 越过选项组：choose 后从其后汇合
        this.enterChoiceGroup(el)
        continue
      }
      if (el.kind === 'command') {
        if (el.name === 'panel') {
          // @panel 是 engine 内部处理、不透传的命令（同 @input 一类）：登记 / 替换该槽的活模板后
          // **继续推进**（它不是暂停点）。命令是硬边界，故先把已成行文本交出去。
          if (this.settleBufferIntoLine()) return
          this.registerPanel(el)
          frame.index++
          continue
        }
        if (el.name === 'input') {
          // @input 是唯一 engine 内部处理、不透传的命令：先 flush 已成行文本（命令硬边界），
          // 再 park 成输入暂停。游标**停在** @input 元素上（不推进）——快照据此天然重建（无需 index 回退）。
          if (this.settleBufferIntoLine()) return // 有缓冲文本 → 先交 continue flush，下轮再 park input
          const placeholder = el.args.length > 1 ? String(this.evalArg(el.args[1]!, el.line)) : null
          this.pendingInput = { varName: el.args[0]!, placeholder }
          return
        }
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

  /** 求值一个命令实参表达式（含 @input 的 placeholder），出错包成带源定位的 RuntimeError。 */
  private evalArg(code: string, line: number): unknown {
    try {
      return evalExpr(code, this.B, this.G, this.L, `${this.currentKnot.name}:cmdarg${line}`)
    } catch (e) {
      throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, this.currentFile, line)
    }
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
        ...(c.resultDivert.targetExpr !== undefined ? { targetExpr: c.resultDivert.targetExpr } : {}),
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
        if (el.targetExpr !== undefined) return this.doDynamicDivert(el.targetExpr, el.line)
        return this.doDivert(el.target, el.args, el.line)
      }
      case 'logicLine':
      case 'logicBlock': {
        frame.index++
        this.runLogic(el.code, false, this.currentFile, el.line)
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
        const args = el.args.map((a) => this.evalArg(a, el.line))
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
      // 同 knot 限定名自跳保留 L（与非限定同级跳转语义一致：参数/局部变量不清、不重记访问）
      if (knot !== this.currentKnot) this.switchKnot(knot)
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
   * 动态跳转 `-> {表达式}`：求值后按类型分派——
   * - 节点引用（$nodes 签发、带内部标记）→ 按其规范化路径（+ 已绑定实参值）跳；
   * - 字符串 → `$nodes[该字符串]` 查表糖：只认 knot 名 / `"父.子"` 全路径 / END/DONE，
   *   不做同级 stitch 相对解析（歧义从规则上消灭）；带参 knot 拒（字符串无处带实参）；
   * - 其他值拒跳。
   */
  private doDynamicDivert(expr: string, line: number): null {
    let v: unknown
    try {
      v = evalExpr(expr, this.B, this.G, this.L, `${this.currentKnot.name}:dyndivert${line}`)
    } catch (e) {
      // $nodes 访问期抛的 RuntimeError（节点不存在等）透传并补源定位；其余包成 JS 执行错误。
      if (e instanceof RuntimeError) throw new RuntimeError(e.message, this.currentFile, line)
      throw new RuntimeError(`JS 执行错误：${(e as Error).message}`, this.currentFile, line)
    }
    const ref = nodeRefData(v)
    if (ref !== null) {
      return this.doDivertResolved(ref.path, ref.args, line)
    }
    if (typeof v === 'string') {
      // 查表糖须先验存在性（与 $nodes 访问同规则）：合成开场 knot 不可及、不存在抛。
      this.assertNodeExists(v, line)
      return this.doDivertResolved(v, null, line)
    }
    throw new RuntimeError(
      `跳转目标须是 $nodes 引用或节点名字符串，收到：${v === null ? 'null' : typeof v}`,
      this.currentFile,
      line,
    )
  }

  /** 校验路径（END/DONE / knot / `父.子`）在节点表中存在；否则抛「节点不存在」。 */
  private assertNodeExists(path: string, line: number): void {
    if (path === 'END' || path === 'DONE') return
    const dot = path.indexOf('.')
    const knotName = dot === -1 ? path : path.slice(0, dot)
    const knot = this.program.knots.get(knotName)
    const knotOk = knot !== undefined && knot.scope !== 'global'
    const ok = dot === -1 ? knotOk : knotOk && this.program.stitches.get(knotName)?.has(path.slice(dot + 1)) === true
    if (!ok) throw new RuntimeError(`节点不存在：「${path}」`, this.currentFile, line)
  }

  /**
   * 按规范化完整路径 + 已绑定实参**值**执行跳转（动态跳转的落地半程）。
   * - `boundArgs` 为 null 表示未绑定：目标是带参 knot 时拒跳（引用与字符串两档同规则）。
   * - 运行时防线（静态 `param-knot-stitch-entry` 的等价物）：跳带参 knot 的 stitch 时，
   *   跳转时所在 knot 不是该 knot → 拒（参数无从绑定）。
   */
  private doDivertResolved(path: string, boundArgs: unknown[] | null, line: number): null {
    if (path === 'END' || path === 'DONE') {
      this.ended = true
      return null
    }
    const dot = path.indexOf('.')
    if (dot !== -1) {
      const parent = path.slice(0, dot)
      const child = path.slice(dot + 1)
      const knot = this.program.knots.get(parent)
      const stitch = this.program.stitches.get(parent)?.get(child)
      if (!knot || !stitch) throw new RuntimeError(`节点不存在：「${path}」`, this.currentFile, line)
      if (knot.params.length > 0 && knot !== this.currentKnot) {
        throw new RuntimeError(
          `不能从外部跳进带参节点「${parent}」的子节点（参数无从绑定）`,
          this.currentFile,
          line,
        )
      }
      if (knot !== this.currentKnot) this.switchKnot(knot)
      this.enterStitch(stitch)
      return null
    }
    const knot = this.program.knots.get(path)
    if (!knot || knot.scope === 'global') {
      throw new RuntimeError(`节点不存在：「${path}」`, this.currentFile, line)
    }
    if (knot.params.length > 0 && boundArgs === null) {
      throw new RuntimeError(
        `带参节点「${path}」须经 $nodes.${path}(实参) 绑定实参后跳转`,
        this.currentFile,
        line,
      )
    }
    const values = boundArgs ?? []
    this.enterKnot(knot)
    knot.params.forEach((p, i) => {
      ;(this.L as Record<string, unknown>)[p] = values[i]
    })
    return null
  }

  /**
   * 渲染行内片段为富文本 spans：literal 取 value + 其 style；interp 段求值转串（null/undefined→空串）
   * 并承继其 style；break → 换行 span。空文本段不产 span；相邻同样式文本段归并（纯文本恒为单 span）。
   * 文本里的**换行符等价于 `<br>`**（切分见模块顶部 `splitLines`）。
   * `line` 为片段所在行（TextLine.line / Choice.line），出错时透传给 RuntimeError 定位。
   */
  private renderSpans(segments: InlineSegment[], line = 0): RichSpan[] {
    const raw: RichSpan[] = []
    // `<pause>` 标记落在「其后首个**有内容**的 span」上：空插值（`{undefined}`）不消费它，
    // 否则 `前半…<pause>{空}后半` 的停顿会凭空消失。顺延时**档位一并携带**。
    let pausePending: PauseKind | null = null
    const pushBreak = () => {
      raw.push(pausePending !== null ? { kind: 'break', pauseBefore: pausePending } : { kind: 'break' })
      pausePending = null
    }
    for (const seg of segments) {
      if (seg.pauseBefore) pausePending = seg.pauseBefore
      if (seg.kind === 'break') {
        pushBreak()
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
      if (text === '') continue // 空段：pausePending 保留，顺延给下一个有内容的段
      // 换行符 → break span，与 `<br>` 同构。literal 段与插值段**一视同仁**：正文 / 选项的
      // literal 来自源码单行（parser 已按行切）天然无换行，而 `@panel` 的模板源串是 JS 求值
      // 结果，其字面换行落在 literal 段——只处理插值段会漏掉它。
      const parts = splitLines(text)
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) pushBreak()
        const part = parts[i]!
        if (part === '') continue // 首尾 / 连续换行切出的空段：同样不产 span、不消费 pausePending
        raw.push(makeTextSpan(part, seg.style, pausePending ?? undefined))
        pausePending = null
      }
    }
    return mergeSpans([], raw) // 经 coalesce 归并相邻同样式段
  }
}
