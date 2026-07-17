import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import type { RichSpan } from '@kiny/engine'
import { RichText } from './RichText'

/**
 * 打字机逐字揭示 + 每字淡入的一行正文。仅用于 StoryLog 的**最新一行**——已定型行走静态 RichText。
 * 速度（字 / 秒）与淡入时长（ms）来自 host（@text_speed / @text_fade）。
 * 全字出完后还有**淡入拖尾期**（末字淡完才算整行完成）：期间保持逐字 span 让动画播完，
 * 之后才切换连贯 RichText 并触发 `onComplete`——否则尾部仍在淡入的字会瞬间跳到全不透明。
 * 无障碍：`prefers-reduced-motion` 或 speed<=0 → 整行瞬显（覆盖作者设置）。
 * `skipToken` 递增 → 立即整行显示（读者点击跳过打字，galgame 惯例；拖尾期点击同样立即定格）。
 * `onComplete` 在整行揭示完成时触发一次（供 usePlayback 决定自动续 / 等点击）。
 */
export function RevealingLine({
  spans,
  speed,
  fade,
  skipToken,
  onComplete,
}: {
  spans: RichSpan[]
  speed: number
  fade: number
  skipToken?: number
  onComplete?: () => void
}) {
  const cells = useMemo(() => toCells(spans), [spans])
  const total = cells.length
  const reduced = usePrefersReducedMotion()
  const instant = reduced || speed <= 0
  const [count, setCount] = useState(instant ? total : 0)
  // 已定格：全字出完**且**淡入拖尾播完（或被 skip/瞬显截断）→ 切连贯 RichText。
  const [settled, setSettled] = useState(instant)

  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const cellsRef = useRef(cells)
  cellsRef.current = cells
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
  // 立即定格：跳过打字 / 瞬显——不等拖尾。
  const finish = useCallback(() => {
    clearTimers()
    setCount(cellsRef.current.length)
    setSettled(true)
    fireComplete()
  }, [fireComplete])

  // skip 判定基线（声明须先于重置 effect，见下）。
  const lastSkip = useRef(skipToken)

  // 每行（spans 变）重置并驱动逐字揭示；全字出完后等末字淡完（拖尾）再定格。
  useEffect(() => {
    clearTimers()
    // 换行即同步 skip 基线：skip 只对「同一行内的 token 变化」生效。否则 StoryLog 按下标
    // 复用实例时（@clear 后新行下标重合、换 story 时 token 重置 0），token 值变化会被误判
    // 为跳过，把新行整段瞬显。
    lastSkip.current = skipToken
    if (instant) {
      setCount(total)
      setSettled(true)
      fireComplete()
      return
    }
    setCount(0)
    setSettled(false)
    let n = 0
    timerRef.current = window.setInterval(() => {
      n++
      setCount(n)
      if (n >= total) {
        clearTimers()
        if (fade > 0) tailRef.current = window.setTimeout(finish, fade)
        else finish()
      }
    }, 1000 / speed)
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, speed, instant, total, fade])

  // skip：点击跳过打字 → 立即整行显示。按「token 值变化」判定而非「effect 首跑」——
  // StrictMode 开发态双跑 effect 时 ref 不重置，布尔首跑标记会在第二跑误触 finish（整段瞬显）。
  useEffect(() => {
    if (skipToken === lastSkip.current) return
    lastSkip.current = skipToken
    finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipToken])

  // 定格后用连贯 RichText（DOM 与静态行一致：合并文本节点、标签渲染，getByText 可匹配）；
  // 打字中与淡入拖尾期保持逐字 span，让在飞的 char-fade 动画自然播完。
  if (settled) return <RichText spans={spans} />
  const animate = !instant && fade > 0
  return (
    <span className="narration-reveal">
      {cells.slice(0, count).map((cell, i) =>
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
      )}
    </span>
  )
}

type Cell = { ch: string; style: CSSProperties; br?: false } | { br: true }

/** 把富文本 spans 拆成逐字单元（含换行标记），每字携带其 span 的样式快照。 */
function toCells(spans: RichSpan[]): Cell[] {
  const cells: Cell[] = []
  for (const s of spans) {
    if (!('text' in s)) {
      cells.push({ br: true }) // { kind: 'break' }
      continue
    }
    const style = styleOf(s)
    for (const ch of Array.from(s.text)) cells.push({ ch, style })
  }
  return cells
}

/** RichSpan 富文本样式 → 内联 CSS（与 RichText 的标签渲染视觉等价）。 */
function styleOf(s: Extract<RichSpan, { text: string }>): CSSProperties {
  const style: CSSProperties = {}
  if (s.bold) style.fontWeight = 700
  if (s.italic) style.fontStyle = 'italic'
  const deco: string[] = []
  if (s.underline) deco.push('underline')
  if (s.strike) deco.push('line-through')
  if (deco.length) style.textDecoration = deco.join(' ')
  if (s.color) style.color = s.color
  if (s.size) style.fontSize = `${s.size}em`
  return style
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
