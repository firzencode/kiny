import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import type { RichSpan } from '@kiny/engine'
import { RichText } from './RichText'
import { spanStyle } from './spanStyle'
import { spanClassName } from './spanClasses'

/**
 * 打字机逐字揭示 + 每字淡入的一行正文。仅用于 StoryLog 的**最新一行**——已定型行走静态 RichText。
 * 速度（字 / 秒）与淡入时长（ms）来自 host（@text_speed / @text_fade）。
 * 全字出完后还有**淡入拖尾期**（末字淡完才算整行完成）：期间保持逐字 span 让动画播完，
 * 之后才切换连贯 RichText 并触发 `onComplete`——否则尾部仍在淡入的字会瞬间跳到全不透明。
 * 无障碍：`prefers-reduced-motion` 或 speed<=0 → 整行瞬显（覆盖作者设置）；但**分段停顿保留**
 * （每段瞬显、标记处仍等点击）——停顿是叙事节奏，不是动效。
 * 句中 `<pause>` 标记把一行切成多段：揭示到边界即停、等读者点击续下一段（`skipToken` 递增）。
 * 点击三档：段中打字 → 当前段立显并停在标记（**不穿透**停顿点）；停在标记 → 揭示下一段；
 * 整行揭示完 → 由 `onComplete` 交回宿主走 line / flow 原逻辑。
 * `onComplete` 只在**整行**揭示完成时触发一次（段间停顿不触发），供 usePlayback 决定自动续 / 等点击。
 * `onAwaitingPause` 上报「是否正停在句中标记处」，宿主据此亮推进提示三角。
 */
export function RevealingLine({
  spans,
  speed,
  fade,
  skipToken,
  onComplete,
  onAwaitingPause,
}: {
  spans: RichSpan[]
  speed: number
  fade: number
  skipToken?: number
  onComplete?: () => void
  onAwaitingPause?: (waiting: boolean) => void
}) {
  const cells = useMemo(() => toCells(spans), [spans])
  const total = cells.length
  const bounds = useMemo(() => pauseBounds(cells), [cells])
  const reduced = usePrefersReducedMotion()
  const instant = reduced || speed <= 0
  // 瞬显且无停顿标记 → 首帧即整行（reset effect 是 passive effect、在 paint 之后才跑，
  // 初值从 0 起会让 reduced-motion 读者每行闪一帧空白）。有标记时首帧仍从 0 起，
  // 由 reset effect 同批算出首段——那一批里 count 不会渲染出中间的 0。
  const fastWhole = instant && bounds.length === 0
  const [count, setCount] = useState(fastWhole ? total : 0)
  // 已定格：全字出完**且**淡入拖尾播完（或被 skip/瞬显截断）→ 切连贯 RichText。
  const [settled, setSettled] = useState(fastWhole)
  // 正停在句中 `<pause>` 边界，等读者点击续下一段。
  const [awaiting, setAwaiting] = useState(false)

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
  const awaitingRef = useRef(false)
  const instantRef = useRef(instant)
  instantRef.current = instant
  const speedRef = useRef(speed)
  speedRef.current = speed
  const fadeRef = useRef(fade)
  fadeRef.current = fade
  /** 当前段的终点（下一处段边界，或整行末）。 */
  const limitRef = useRef(total)
  // onComplete 按「当前 cells 身份」只触发一次——StrictMode 双跑 effect / 重复 finish 都不会重复触发。
  const firedRef = useRef<Cell[] | null>(null)
  const timerRef = useRef<number | null>(null) // 逐字 interval
  const tailRef = useRef<number | null>(null) // 淡入拖尾 timeout
  const clearTimers = () => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (tailRef.current != null) {
      clearTimeout(tailRef.current)
      tailRef.current = null
    }
  }
  const fireComplete = useCallback(() => {
    if (firedRef.current !== cellsRef.current) {
      firedRef.current = cellsRef.current
      onCompleteRef.current?.()
    }
  }, [])
  const setAwaitingBoth = useCallback((v: boolean) => {
    awaitingRef.current = v
    setAwaiting(v)
  }, [])
  const setCountBoth = useCallback((n: number) => {
    countRef.current = n
    setCount(n)
  }, [])
  /** 从 `from` 之后的第一处段边界；没有则整行末。 */
  const nextLimit = useCallback((from: number) => {
    for (const b of boundsRef.current) if (b > from) return b
    return totalRef.current
  }, [])
  // 整行定格：跳过打字 / 瞬显——不等拖尾。
  const finish = useCallback(() => {
    clearTimers()
    setCountBoth(cellsRef.current.length)
    setAwaitingBoth(false)
    settledRef.current = true
    setSettled(true)
    fireComplete()
  }, [fireComplete, setAwaitingBoth, setCountBoth])
  /** 当前段揭示完：整行末 → 定格（可带淡入拖尾）；句中边界 → 停下等点击。 */
  const finishSegment = useCallback((withTail: boolean) => {
    clearTimers()
    if (limitRef.current >= totalRef.current) {
      if (withTail && fadeRef.current > 0) tailRef.current = window.setTimeout(finish, fadeRef.current)
      else finish()
      return
    }
    setAwaitingBoth(true)
  }, [finish, setAwaitingBoth])
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
    setAwaitingBoth(false)
    limitRef.current = nextLimit(-1) // 行首标记 → limit 0 → 先等一次点击再出文字
    // `total > 0` 是必要条件：空 spans 的行（glue 拼接出的空 text 事件）limit 也是 0，
    // 但它没有行首标记、也没有内容——落进等待分支会让 onComplete 永不触发，flow 模式就此停住。
    if (total > 0 && limitRef.current <= 0) {
      setAwaitingBoth(true)
      return clearTimers
    }
    revealSegment()
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, speed, instant, total, fade])

  // 上报「停在句中标记」给宿主（亮 / 灭推进提示三角）。
  // 只在**值变化**时上报，且挂载时的初始 false 不报——否则会覆盖宿主刚因「整行揭示完」
  // 设上的等待态（瞬显模式下整行在重置 effect 里同步完成，本 effect 紧随其后跑）。
  const lastReportedRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (lastReportedRef.current === awaiting) return
    if (lastReportedRef.current === null && !awaiting) {
      lastReportedRef.current = false
      return
    }
    // 整行已定格 → 等待与否交回 `onComplete`（宿主的 line / flow 逻辑）处置。
    // 瞬显模式下「续段」与「整行完成」同批发生：onComplete 先把 line 模式的等待态设上，
    // 本 effect 随后才看到 awaiting 由 true 变 false——补报会把那个等待态覆盖掉、三角该亮不亮。
    if (settledRef.current && !awaiting) {
      lastReportedRef.current = false
      return
    }
    lastReportedRef.current = awaiting
    onAwaitingPauseRef.current?.(awaiting)
  }, [awaiting])
  // 卸载时若还停在标记上，补报一次 false，免三角残留到下一行。
  useEffect(() => () => {
    if (lastReportedRef.current === true) onAwaitingPauseRef.current?.(false)
  }, [])

  // 点击三档。按「token 值变化」判定而非「effect 首跑」——StrictMode 开发态双跑 effect 时
  // ref 不重置，布尔首跑标记会在第二跑误触（整段瞬显）。
  useEffect(() => {
    if (skipToken === lastSkip.current) return
    lastSkip.current = skipToken
    if (settledRef.current) return // ③ 整行已完：交回宿主（line 出下一行 / flow 已自动续）
    if (awaitingRef.current) {
      // ② 停在标记 → 揭示下一段
      setAwaitingBoth(false)
      limitRef.current = nextLimit(countRef.current)
      revealSegment()
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
  const animate = !instant && fade > 0
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
  | { ch: string; style: CSSProperties; cls?: string; pause?: true; br?: false }
  | { br: true; pause?: true }

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
 * `<pause>` 停顿标记落到该 span **首个**单元的 `pause` 上，成为分段揭示的段边界。
 */
function toCells(spans: RichSpan[]): Cell[] {
  const cells: Cell[] = []
  for (const s of spans) {
    if (!('text' in s)) {
      cells.push(s.pauseBefore ? { br: true, pause: true } : { br: true }) // { kind: 'break' }
      continue
    }
    const style = spanStyle(s)
    const cls = spanClassName(s.classes)
    let first = true
    for (const ch of Array.from(s.text)) {
      const cell: Cell = cls === undefined ? { ch, style } : { ch, style, cls }
      if (first && s.pauseBefore) cell.pause = true
      first = false
      cells.push(cell)
    }
  }
  return cells
}

/** 段边界下标（升序）：`cells[i]` 前有 `<pause>`。 */
function pauseBounds(cells: Cell[]): number[] {
  const out: number[] = []
  cells.forEach((c, i) => { if (c.pause) out.push(i) })
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
