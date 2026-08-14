import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import type { PauseKind, RichSpan } from '@kiny/engine'
import { RichText } from './RichText'
import { spanStyle } from './spanStyle'
import { spanClassName } from './spanClasses'

/**
 * 打字机逐字揭示 + 每字淡入的一行正文。仅用于 StoryLog 的**最新一行**——已定型行走静态 RichText。
 * 速度（字 / 秒）与淡入时长（ms）来自 host（@text_speed / @text_fade）。
 * 全字出完后还有**淡入拖尾期**（末字淡完才算整行完成）：期间保持逐字 span 让动画播完，
 * 之后才切换连贯 RichText 并触发 `onComplete`——否则尾部仍在淡入的字会瞬间跳到全不透明。
 * 无障碍：`prefers-reduced-motion` 或 speed<=0 → 整行瞬显（覆盖作者设置）；但**分段停顿保留**
 * （每段瞬显、标记处仍等待）——停顿是叙事节奏，不是动效。
 * 唯一的例外是 `instant`：那是**宿主**说「这一行立即完成、不做任何等待」（editor 预览的快进调试
 * 开关），停顿一并跳过。读者端不传，故上面那条规矩对读者恒成立。
 * 句中 `<pause>` 标记把一行切成多段，两档：
 * - **点击档**（`<pause>`）：揭示到边界即停、等读者点击续下一段（`skipToken` 递增）。
 * - **毫秒档**（`<pause=毫秒>`）：起定时器，停满时长自动续下一段；等待期间点击**完全无效**
 *   （既不提前续段也不整行立显），与 `@sleep` 同一哲学。
 * 点击三档（仅点击档参与）：段中打字 → 当前段立显并停在标记（**不穿透**停顿点）；停在标记 → 揭示下一段；
 * 整行揭示完 → 由 `onComplete` 交回宿主走 line / flow 原逻辑。
 * `onComplete` 只在**整行**揭示完成时触发一次（段间停顿两档皆不触发），供 usePlayback 决定自动续 / 等点击。
 * `onAwaitingPause` 上报当前等待档位（`'click'` / `'timed'` / `null`）：宿主据此亮推进提示三角
 * （只有 `'click'` 亮）并做点击门控（两档都拦下点击，`'timed'` 拦下后丢弃）。
 */
export type AwaitKind = 'click' | 'timed' | null

export function RevealingLine({
  spans,
  speed,
  fade,
  skipToken,
  instant = false,
  onComplete,
  onAwaitingPause,
}: {
  spans: RichSpan[]
  speed: number
  fade: number
  skipToken?: number
  /** 宿主要求立即完成、不做任何等待（见 `RevealBinding.instant`）。 */
  instant?: boolean
  onComplete?: () => void
  onAwaitingPause?: (waiting: AwaitKind) => void
}) {
  const cells = useMemo(() => toCells(spans), [spans])
  const total = cells.length
  // 宿主要求不做任何等待 → 段边界清空。两档停顿都由 bounds 驱动（`nextLimit` / `enterPauseWait`），
  // 清掉它即两档一并旁路，不必在计时分支里各加一处判断。
  const bounds = useMemo(() => (instant ? [] : pauseBounds(cells)), [cells, instant])
  const reduced = usePrefersReducedMotion()
  // 是否整行瞬显。三个来源：无障碍偏好、作者的 `@text_speed(0)`、宿主的 instant。
  // 前两者**保留**分段停顿（叙事节奏，不是动效），只有 instant 连停顿一起跳——差别在上面的 bounds。
  const instantReveal = reduced || speed <= 0 || instant
  // 瞬显且无停顿标记 → 首帧即整行（reset effect 是 passive effect、在 paint 之后才跑，
  // 初值从 0 起会让 reduced-motion 读者每行闪一帧空白）。有标记时首帧仍从 0 起，
  // 由 reset effect 同批算出首段——那一批里 count 不会渲染出中间的 0。
  const fastWhole = instantReveal && bounds.length === 0
  const [count, setCount] = useState(fastWhole ? total : 0)
  // 已定格：全字出完**且**淡入拖尾播完（或被 skip/瞬显截断）→ 切连贯 RichText。
  const [settled, setSettled] = useState(fastWhole)
  // 正停在句中 `<pause>` 边界：'click' 等读者点击，'timed' 等定时器满，null 未在等待。
  const [awaiting, setAwaiting] = useState<AwaitKind>(null)

  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onAwaitingPauseRef = useRef(onAwaitingPause)
  onAwaitingPauseRef.current = onAwaitingPause
  const cellsRef = useRef(cells)
  cellsRef.current = cells
  // 热值放 ref：段推进在 timer / 点击回调里发生，不能读闭包快照。
  const totalRef = useRef(total)
  totalRef.current = total
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const countRef = useRef(fastWhole ? total : 0)
  const settledRef = useRef(fastWhole)
  const awaitingRef = useRef<AwaitKind>(null)
  const instantRef = useRef(instantReveal)
  instantRef.current = instantReveal
  const speedRef = useRef(speed)
  speedRef.current = speed
  const fadeRef = useRef(fade)
  fadeRef.current = fade
  /** 当前段的终点（下一处段边界，或整行末）。 */
  const limitRef = useRef(total)
  /** 当前段终点处那个停顿标记的档位（`limitRef` 已是整行末则为 null）。 */
  const limitPauseRef = useRef<PauseKind | null>(null)
  // onComplete 按「当前 cells 身份」只触发一次——StrictMode 双跑 effect / 重复 finish 都不会重复触发。
  const firedRef = useRef<Cell[] | null>(null)
  const timerRef = useRef<number | null>(null) // 逐字 interval
  const tailRef = useRef<number | null>(null) // 淡入拖尾 timeout
  const pauseTimerRef = useRef<number | null>(null) // 毫秒档停顿 timeout
  const clearTimers = () => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (tailRef.current != null) {
      clearTimeout(tailRef.current)
      tailRef.current = null
    }
    if (pauseTimerRef.current != null) {
      clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
  }
  const fireComplete = useCallback(() => {
    if (firedRef.current !== cellsRef.current) {
      firedRef.current = cellsRef.current
      onCompleteRef.current?.()
    }
  }, [])
  const setAwaitingBoth = useCallback((v: AwaitKind) => {
    awaitingRef.current = v
    setAwaiting(v)
  }, [])
  // 上报去重：`'unset'` = 尚未上报过（null 已是合法上报值，不能兼作哨兵）。
  // ⚠ 上报既开关三角、又是三个宿主的点击门控真相源，清空的**时机与顺序**是不变量：
  // 不报 → 宿主的门控 ref 永久残留、点击被吞；迟报 → 覆盖掉 onComplete 刚设上的等待态。
  // 故 `finish()` 内必须先同步报 null 再 fireComplete（另见那里的说明）。
  const lastReportedRef = useRef<AwaitKind | 'unset'>('unset')
  const reportAwait = useCallback((v: AwaitKind) => {
    if (lastReportedRef.current === v) return
    lastReportedRef.current = v
    onAwaitingPauseRef.current?.(v)
  }, [])
  const setCountBoth = useCallback((n: number) => {
    countRef.current = n
    setCount(n)
  }, [])
  /** 从 `from` 之后的第一处段边界（含其档位）；没有则整行末（档位 null）。 */
  const nextLimit = useCallback((from: number): { at: number; pause: PauseKind | null } => {
    for (const b of boundsRef.current) if (b.at > from) return { at: b.at, pause: b.pause }
    return { at: totalRef.current, pause: null }
  }, [])
  /** 把段终点推进到 `from` 之后的下一处边界（同时记下该边界档位）。 */
  const advanceLimit = useCallback((from: number) => {
    const r = nextLimit(from)
    limitRef.current = r.at
    limitPauseRef.current = r.pause
  }, [nextLimit])
  // 整行定格：跳过打字 / 瞬显——不等拖尾。
  const finish = useCallback(() => {
    clearTimers()
    setCountBoth(cellsRef.current.length)
    setAwaitingBoth(null)
    // **先同步清等待态、再 fireComplete**：等待态是宿主的点击门控真相源，留着 'click' / 'timed'
    // 会让整行完成后的点击被永久吞掉（line 模式再也出不来下一行）。而顺序反过来（事后由
    // effect 补报）又会把 onComplete 刚设上的「整行完等点击」覆盖掉——故此处同步、且在前。
    reportAwait(null)
    settledRef.current = true
    setSettled(true)
    fireComplete()
  }, [fireComplete, reportAwait, setAwaitingBoth, setCountBoth])
  // 续段与「进入等待」互相引用（等满 → 续段 → 揭示完 → 再进入等待），用 ref 断开 useCallback 循环依赖。
  const continueRef = useRef<() => void>(() => {})
  /**
   * 抵达句中段边界：点击档置等待态（宿主亮三角）；毫秒档起定时器自动续段、**不置**点击等待
   * ——这不是「等你点击」态，三角不亮（与 `@sleep` 等待期间一致）。
   */
  const enterPauseWait = useCallback(() => {
    const kind = limitPauseRef.current
    if (typeof kind === 'number') {
      setAwaitingBoth('timed')
      pauseTimerRef.current = window.setTimeout(() => {
        pauseTimerRef.current = null
        continueRef.current()
      }, kind)
      return
    }
    setAwaitingBoth('click')
  }, [setAwaitingBoth])
  /** 当前段揭示完：整行末 → 定格（可带淡入拖尾）；句中边界 → 按档位等待。 */
  const finishSegment = useCallback((withTail: boolean) => {
    clearTimers()
    if (limitRef.current >= totalRef.current) {
      if (withTail && fadeRef.current > 0) tailRef.current = window.setTimeout(finish, fadeRef.current)
      else finish()
      return
    }
    enterPauseWait()
  }, [finish, enterPauseWait])
  /** 揭示当前段：瞬显模式直接跳到段末，否则起逐字 interval。 */
  const revealSegment = useCallback(() => {
    if (instantRef.current) {
      setCountBoth(limitRef.current)
      finishSegment(false) // 瞬显无淡入拖尾
      return
    }
    timerRef.current = window.setInterval(() => {
      const n = countRef.current + 1
      setCountBoth(n)
      if (n >= limitRef.current) finishSegment(true)
    }, 1000 / speedRef.current)
  }, [finishSegment, setCountBoth])
  /** 离开等待态、推进到下一段并揭示（点击档由点击驱动，毫秒档由定时器驱动）。 */
  const continueSegment = useCallback(() => {
    setAwaitingBoth(null)
    advanceLimit(countRef.current)
    revealSegment()
  }, [advanceLimit, revealSegment, setAwaitingBoth])
  continueRef.current = continueSegment

  // skip 判定基线（声明须先于重置 effect，见下）。
  const lastSkip = useRef(skipToken)

  // 每行（spans 变）重置并驱动分段揭示；整行出完后等末字淡完（拖尾）再定格。
  useEffect(() => {
    clearTimers()
    // 换行即同步 skip 基线：skip 只对「同一行内的 token 变化」生效。否则 StoryLog 按下标
    // 复用实例时（@clear 后新行下标重合、换 story 时 token 重置 0），token 值变化会被误判
    // 为跳过，把新行整段瞬显。
    lastSkip.current = skipToken
    settledRef.current = false
    setSettled(false)
    setCountBoth(0)
    setAwaitingBoth(null)
    advanceLimit(-1) // 行首标记 → limit 0 → 先等（点击 / 满时长）再出文字
    // `total > 0` 是必要条件：空 spans 的行（glue 拼接出的空 text 事件）limit 也是 0，
    // 但它没有行首标记、也没有内容——落进等待分支会让 onComplete 永不触发，flow 模式就此停住。
    if (total > 0 && limitRef.current <= 0) {
      enterPauseWait()
      return clearTimers
    }
    revealSegment()
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // instant 单列一项：它只经 bounds 影响本 effect，而 bounds 不在依赖里；若作品设了
    // `@text_speed(0)`，instantReveal 恒真、切换 instant 不会让它变化，漏掉就仍停在 <pause>。
  }, [cells, speed, instantReveal, instant, total, fade])

  // 上报「停在句中标记」给宿主（据此亮 / 灭推进提示三角 + 做点击门控）。
  // 只在**值变化**时上报，且挂载时的初始 null 不报——否则会覆盖宿主刚因「整行揭示完」设上的等待态。
  // 「整行定格」这一路的清空由 `finish()` 同步先报（见上），本 effect 只负责「进入等待」方向。
  useEffect(() => {
    if (lastReportedRef.current === 'unset' && awaiting === null) {
      lastReportedRef.current = null
      return
    }
    reportAwait(awaiting)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting])
  // 卸载时若还停在标记上，补报一次 null，免三角 / 点击门控残留到下一行。
  useEffect(() => () => {
    const last = lastReportedRef.current
    if (last !== 'unset' && last !== null) onAwaitingPauseRef.current?.(null)
  }, [])

  // 点击三档。按「token 值变化」判定而非「effect 首跑」——StrictMode 开发态双跑 effect 时
  // ref 不重置，布尔首跑标记会在第二跑误触（整段瞬显）。
  useEffect(() => {
    if (skipToken === lastSkip.current) return
    lastSkip.current = skipToken
    if (settledRef.current) return // ③ 整行已完：交回宿主（line 出下一行 / flow 已自动续）
    // 毫秒档等待中：点击**完全无效**——既不提前续段，也不整行立显（停顿是作者钦定的演出拍点）。
    if (awaitingRef.current === 'timed') return
    if (awaitingRef.current === 'click') {
      continueSegment() // ② 停在点击档标记 → 揭示下一段
      return
    }
    // ① 段中打字 → 当前段立显，**停在标记不穿透**（停顿是作者钦定的演出拍点）
    clearTimers()
    setCountBoth(limitRef.current)
    finishSegment(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipToken])

  // 定格后用连贯 RichText（DOM 与静态行一致：合并文本节点、标签渲染，getByText 可匹配）；
  // 打字中与淡入拖尾期保持逐字 span，让在飞的 char-fade 动画自然播完。
  if (settled) return <RichText spans={spans} />
  const animate = !instantReveal && fade > 0
  return (
    <span className="narration-reveal">
      {groupByClass(cells.slice(0, count)).map((g, gi) => {
        const chars = g.items.map(({ cell, i }) =>
          cell.br ? (
            <br key={i} />
          ) : (
            <span
              key={i}
              className={animate ? 'rchar' : undefined}
              style={animate ? { ...cell.style, animationDuration: `${fade}ms` } : cell.style}
            >
              {cell.ch}
            </span>
          ),
        )
        // 作品 class 挂在**整段外层**（与定格后的 RichText 同构）：背景 / 边框 / ::before 之类
        // 只出现一次，且揭示态切定格态时盒模型不跳变。逐字 rchar 留在内层保证淡入动画。
        return g.cls === undefined
          ? <Fragment key={gi}>{chars}</Fragment>
          : <span key={gi} className={g.cls}>{chars}</span>
      })}
    </span>
  )
}

type Cell =
  | { ch: string; style: CSSProperties; cls?: string; pause?: PauseKind; br?: false }
  | { br: true; pause?: PauseKind }

/** 把逐字单元按「连续同作品 class」分组（换行单独成组，class 为 undefined）。 */
function groupByClass(cells: Cell[]): { cls?: string; items: { cell: Cell; i: number }[] }[] {
  const out: { cls?: string; items: { cell: Cell; i: number }[] }[] = []
  cells.forEach((cell, i) => {
    const cls = 'br' in cell && cell.br === true ? undefined : (cell as { cls?: string }).cls
    const last = out[out.length - 1]
    if (last && last.cls === cls) last.items.push({ cell, i })
    else out.push({ cls, items: [{ cell, i }] })
  })
  return out
}

/**
 * 把富文本 spans 拆成逐字单元（含换行标记），每字携带其 span 的样式快照 + 作品 class。
 * `<pause>` 停顿标记（连同档位）落到该 span **首个**单元的 `pause` 上，成为分段揭示的段边界。
 */
function toCells(spans: RichSpan[]): Cell[] {
  const cells: Cell[] = []
  for (const s of spans) {
    if (!('text' in s)) {
      cells.push(s.pauseBefore ? { br: true, pause: s.pauseBefore } : { br: true }) // { kind: 'break' }
      continue
    }
    const style = spanStyle(s)
    const cls = spanClassName(s.classes)
    let first = true
    for (const ch of Array.from(s.text)) {
      const cell: Cell = cls === undefined ? { ch, style } : { ch, style, cls }
      if (first && s.pauseBefore) cell.pause = s.pauseBefore
      first = false
      cells.push(cell)
    }
  }
  return cells
}

/** 段边界（升序）：`cells[at]` 前有 `<pause>`，`pause` 是该边界的档位（true 点击 / 数字毫秒）。 */
function pauseBounds(cells: Cell[]): { at: number; pause: PauseKind }[] {
  const out: { at: number; pause: PauseKind }[] = []
  cells.forEach((c, i) => { if (c.pause) out.push({ at: i, pause: c.pause }) })
  return out
}

/** 系统「减弱动态效果」偏好（无障碍底线）。jsdom 无 matchMedia → 返回 false。 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}
