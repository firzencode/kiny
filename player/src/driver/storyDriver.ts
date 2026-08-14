import { RuntimeError } from '@kiny/engine'
import type { Story, ChoiceView, RichSpan } from '@kiny/engine'
import { type HostState, type ResolveAsset, emptyHost, applyCommand, applyPanel } from '../host/commands'

/**
 * 正文流里的一条内容。`image` 是 `@img` 产出的插图——与 narration 并列的一条内容行，
 * 随正文滚动、留在阅读历史里（区别于始终垫在底下的全屏背景层 `@bg_show`）。
 * `src` 已 resolve 为宿主 URL（归约时解析，与 sfx 同处）；`cls` 存作者写的**原始**类名，渲染时才加前缀。
 * `divider` 是 `@divider` 产出的分割线，与 image 同形态——块级、独占正文流一条，故**不进** RichSpan
 * 体系：块级元素套进 `<p class="narration">` 是无效 HTML 嵌套。
 */
export type LogEntry =
  | { kind: 'narration'; spans: RichSpan[] }
  | { kind: 'image'; src: string; alt?: string; cls?: string }
  | { kind: 'divider'; cls?: string }
  | { kind: 'end' }

/** 待填输入框的可呈现态（varName 是 engine 内部事，宿主渲染不需要，故不下放）。 */
export interface InputView {
  placeholder: string | null
}

export interface PlayState {
  log: LogEntry[]
  host: HostState
  choices: ChoiceView[]
  /** 停在 @input 输入框时非空；与 choices 互斥（同一时刻至多其一）。 */
  input: InputView | null
  ended: boolean
  error: { message: string; file?: string; line?: number } | null
}

export const initialState: PlayState = {
  log: [], host: emptyHost, choices: [], input: null, ended: false, error: null,
}

/** advance/choose 的结果：归约后的持续状态 + 本次推进新触发的瞬时音效。 */
export interface AdvanceResult {
  state: PlayState
  /** 本次推进新触发的一次性音效 URL（已 resolve，可多个，顺序与触发序一致）。瞬时，不进 PlayState。 */
  sfx: string[]
  /**
   * 本次 `step` 撞上 `@sleep` 而中断时的停顿时长（毫秒）；宿主等满后再续一步。
   * 与 sfx 同类的**瞬时**字段——不进 PlayState / HostState / 存档，故重放与读档零等待。
   * `advance`（一次排空）恒不产出它：sleep 在那条路径上被直接吞掉。
   */
  pendingSleep?: number
}

/** setTimeout 的延时是 int32：超过即回绕成「立刻触发」，故在此夹紧（约 24.8 天，够任何演出用）。 */
const MAX_SLEEP_MS = 2 ** 31 - 1

/**
 * 运行期时长兜底：非有限数 / 负数按 0（analyze 只能拦字面量，变量参留到这里），超大值夹到 int32 上限
 * ——否则 `setTimeout(fn, 2**31)` 会被当 1ms 立即触发，作者在预览里根本看不出写错了数量级。
 * 只在 `step` 分支调用：`advance` 吞掉 sleep，那条路径不该为用不上的值刷 warn。
 */
export function sleepMillis(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`player: @sleep 时长非法（${String(raw)}），按 0 处理`)
    return 0
  }
  if (n > MAX_SLEEP_MS) {
    console.warn(`player: @sleep 时长 ${n}ms 超出上限，按 ${MAX_SLEEP_MS}ms 处理`)
    return MAX_SLEEP_MS
  }
  return n
}

function asError(err: unknown): PlayState['error'] {
  if (err instanceof RuntimeError) return { message: err.message, file: err.file, line: err.line }
  throw err
}

/**
 * `@img` 的运行期兜底（analyze 只能拦字面量，表达式参留到这里，与 `@sleep` 同策略）：
 * 路径非字符串 / 空串 → 返回 null，该条插图整个跳过（不渲染半截）；
 * 替代文字非字符串 → 按缺省（装饰性图片，`alt=""`）；类名非法 → 忽略类名、图照常渲染。
 * 诊断经 `warnings` 回传而非就地打印——`advance`（重放 / editor 每次编辑重算）会吞掉它们，
 * 否则一条写错的动态路径会随每次重算刷屏（同 `@sleep` 的立场）。
 */
export function imageEntry(
  args: unknown[],
  resolve: ResolveAsset,
  warnings: string[],
): Extract<LogEntry, { kind: 'image' }> | null {
  const rawSrc = args[0]
  if (typeof rawSrc !== 'string' || rawSrc.trim() === '') {
    warnings.push(`player: @img 的路径非法（${String(rawSrc)}），跳过该插图`)
    return null
  }
  // 与 cls 同样先 trim 再用：判空看的是 trim 后的串，resolve 却拿原串的话，
  // `@img(" a.png ")` 会解析出带首尾空格的 URL 而 404——两处必须看同一个值。
  const entry: Extract<LogEntry, { kind: 'image' }> = { kind: 'image', src: resolve(rawSrc.trim()) }
  if (typeof args[1] === 'string' && args[1] !== '') entry.alt = args[1]
  const cls = args[2]
  if (typeof cls === 'string' && VALID_CLASS.test(cls.trim())) entry.cls = cls.trim()
  else if (cls !== undefined) warnings.push(`player: @img 的类名非法（${String(cls)}），已忽略`)
  return entry
}

/**
 * `@divider([类名])` → 分割线 log 项。与 `imageEntry` 的分歧：**永不返回 null**——
 * `@img` 路径非法要整条跳过（没有路径就没有图），而分割线没有必需参数，一个坏类名不该让
 * 分隔本身消失，故只丢类名、照常产出。
 */
export function dividerEntry(args: unknown[], warnings: string[]): Extract<LogEntry, { kind: 'divider' }> {
  const entry: Extract<LogEntry, { kind: 'divider' }> = { kind: 'divider' }
  const cls = args[0]
  if (typeof cls === 'string' && VALID_CLASS.test(cls.trim())) entry.cls = cls.trim()
  else if (cls !== undefined) warnings.push(`player: @divider 的类名非法（${String(cls)}），已忽略`)
  return entry
}

/** 类名合法性（与行内 `<class=名>` 同规则）：Unicode 字母数字与 `_ -`，不含空格与点。 */
const VALID_CLASS = /^[\p{L}\p{N}_-]+$/u

/** 归约单个事件：文字 / 插图 / 分割线进 log（并标记产出一行）、sfx 瞬时收集、clear 清 log、sleep 标记停顿、其余走 applyCommand。 */
function reduceEvent(
  e: ReturnType<Story['continue']>,
  log: LogEntry[],
  host: HostState,
  sfx: string[],
  resolve: ResolveAsset,
  warnings: string[],
): { log: LogEntry[]; host: HostState; producedLine: boolean; sleep?: { raw: unknown } } {
  if (e.kind === 'text') return { log: [...log, { kind: 'narration', spans: e.spans }], host, producedLine: true }
  // 固定区域更新：改 host.panels（持续状态），不产出行、不算一次揭示。
  if (e.kind === 'panel') return { log, host: applyPanel(host, e.slot, e.spans), producedLine: false }
  if (e.name === 'sfx') {
    sfx.push(resolve(String(e.args[0]))) // 一次性音效：瞬时收集，不进 host
    return { log, host, producedLine: false }
  }
  if (e.name === 'img') {
    // 插图是正文流里的一条**内容行**：producedLine 让 step 在此返回，line 模式停下等点击、
    // flow 模式照常自动流过——与 narration 同等待遇。路径非法则整条跳过、不算产出行。
    const entry = imageEntry(e.args, resolve, warnings)
    return entry === null ? { log, host, producedLine: false } : { log: [...log, entry], host, producedLine: true }
  }
  if (e.name === 'divider') {
    // 与插图同等待遇：分割线是正文流里的一条**内容行**，producedLine 让 step 在此返回——
    // line 模式停下等点击（「点击 → 出现分割线 → 点击 → 下一段」正是幕间节奏），flow 模式照常流过。
    return { log: [...log, dividerEntry(e.args, warnings)], host, producedLine: true }
  }
  if (e.name === 'clear') return { log: [], host, producedLine: false } // 清屏：清空已显示正文；bg/bgm 不动
  // 演出停顿：不改任何状态，只把**原始**参数交给调用方（step 据此中断并归一，advance 直接吞——
  // 故重放路径不会为一个用不上的值刷 warn）。
  if (e.name === 'sleep') return { log, host, producedLine: false, sleep: { raw: e.args[0] } }
  return { log, host: applyCommand(host, e, resolve), producedLine: false }
}

/** 抵暂停点后归约输入框 / 选项 / 结束态。 */
function pauseState(story: Story, log: LogEntry[], host: HostState): PlayState {
  if (story.hasEnded) return { log: [...log, { kind: 'end' }], host, choices: [], input: null, ended: true, error: null }
  const input = story.currentInput
  if (input !== null) {
    // 停在输入框：必须先于下面「choices 空 → 视同结束」兜底判定，否则输入暂停会被误判成结束。
    return { log, host, choices: [], input: { placeholder: input.placeholder }, ended: false, error: null }
  }
  const choices = story.currentChoices
  if (choices.length === 0) {
    // 无可见选项又未结束（同 cli player）：视同结束
    return { log: [...log, { kind: 'end' }], host, choices: [], input: null, ended: true, error: null }
  }
  return { log, host, choices, input: null, ended: false, error: null }
}

/** 从当前 Story 一次排空到下一个暂停点（选项 / 结束 / 出错），归约出新 PlayState + 本次瞬时 sfx。
 * 用于 replay / restore / 编辑器跳转的最终态重建（无动画）。现场前向播放改用 `step`。
 * `@sleep` 在这条路径上被直接吞掉——重放 / 读档 / 编辑重算零等待，天然幂等。 */
export function advance(story: Story, prev: PlayState, resolve: ResolveAsset): AdvanceResult {
  let log = prev.log
  let host = prev.host
  const sfx: string[] = []
  const warnings: string[] = [] // 重放路径吞掉：editor 每次编辑重算都走这里，不该为同一处笔误反复刷屏
  try {
    while (story.canContinue) {
      const r = reduceEvent(story.continue(), log, host, sfx, resolve, warnings)
      log = r.log
      host = r.host
    }
  } catch (err) {
    return { state: { ...prev, log, host, choices: [], input: null, error: asError(err) }, sfx }
  }
  return { state: pauseState(story, log, host), sfx }
}

/**
 * 逐事件推进：途经命令（bg/sfx/clear/打字机设定）**即时应用**，**产出一行 narration 即返回**，
 * 或抵暂停点（选项 / 结束 / 出错）返回。保证 bg/sfx/clear 与该行揭示同步（advance 一次排空会让
 * 命令早于其文字触发、失同步）。不变量：连续 `step` 累积态 == 一次 `advance` 排空的结果。
 */
export function step(story: Story, prev: PlayState, resolve: ResolveAsset): AdvanceResult {
  // 已结束 / 出错态：no-op（防御——重复 step 不再追加第二个 end 标记，含 StrictMode 重入）。
  if (prev.ended || prev.error) return { state: prev, sfx: [] }
  let log = prev.log
  let host = prev.host
  const sfx: string[] = []
  const warnings: string[] = [] // 现场播放路径：作者此刻就该看到（下面逐条打印）
  try {
    while (story.canContinue) {
      const r = reduceEvent(story.continue(), log, host, sfx, resolve, warnings)
      log = r.log
      host = r.host
      for (const w of warnings.splice(0)) console.warn(w)
      if (r.sleep !== undefined) {
        // 撞上 @sleep：在此中断排空，把时长交给宿主（等满后再 step 续）。状态与产出一行时同形：
        // 尚未抵暂停点，故 choices=[]、未结束——选项 / 结束都要等停顿满了才浮现。
        return { state: { log, host, choices: [], input: null, ended: false, error: null }, sfx, pendingSleep: sleepMillis(r.sleep.raw) }
      }
      if (r.producedLine) {
        // 产出一行即返回：尚未抵暂停点 → choices=[]、input=null、未结束（由后续 step 抵达）。
        return { state: { log, host, choices: [], input: null, ended: false, error: null }, sfx }
      }
    }
  } catch (err) {
    return { state: { ...prev, log, host, choices: [], input: null, error: asError(err) }, sfx }
  }
  return { state: pauseState(story, log, host), sfx }
}

/** 玩家选择 index（= ChoiceView.index），推进 Story 后**一次排空**到下一个暂停点（最终态，无动画）。 */
export function choose(story: Story, prev: PlayState, index: number, resolve: ResolveAsset): AdvanceResult {
  try {
    story.choose(index)
  } catch (err) {
    return { state: { ...prev, choices: [], input: null, error: asError(err) }, sfx: [] }
  }
  return advance(story, { ...prev, choices: [] }, resolve)
}

/** 同 choose，但选后只 `step` 一行（供 usePlayback 逐行揭示后续正文）。 */
export function chooseStep(story: Story, prev: PlayState, index: number, resolve: ResolveAsset): AdvanceResult {
  try {
    story.choose(index)
  } catch (err) {
    return { state: { ...prev, choices: [], input: null, error: asError(err) }, sfx: [] }
  }
  return step(story, { ...prev, choices: [] }, resolve)
}

/** 读者提交输入框文本，推进 Story 后**一次排空**到下一个暂停点（最终态，无动画；replay / editor 预览用）。 */
export function submitInput(story: Story, prev: PlayState, text: string, resolve: ResolveAsset): AdvanceResult {
  try {
    story.submitInput(text)
  } catch (err) {
    return { state: { ...prev, input: null, error: asError(err) }, sfx: [] }
  }
  return advance(story, { ...prev, input: null }, resolve)
}

/** 同 submitInput，但提交后只 `step` 一行（供 usePlayback 逐行揭示后续正文）。 */
export function submitInputStep(story: Story, prev: PlayState, text: string, resolve: ResolveAsset): AdvanceResult {
  try {
    story.submitInput(text)
  } catch (err) {
    return { state: { ...prev, input: null, error: asError(err) }, sfx: [] }
  }
  return step(story, { ...prev, input: null }, resolve)
}
