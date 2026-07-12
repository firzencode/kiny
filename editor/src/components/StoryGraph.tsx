import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ValidatedProgram } from '@kiny/engine'
import { buildGraph, ownerKnotId, END_ID } from '../graph/buildGraph'
import type { GraphEdge } from '../graph/buildGraph'
import { layout } from '../graph/layout'
import type { GraphLayout, LaidOutEdge, LaidOutNode } from '../graph/layout'

/** knot 数超此阈值 → 降级：折叠 stitch 明细、只画 knot 概览。 */
const COLLAPSE_THRESHOLD = 200
const MIN_SCALE = 0.15
const MAX_SCALE = 2.4

interface Transform {
  tx: number
  ty: number
  scale: number
}

/**
 * 剧情结构图：把项目全部 knot/stitch 与跳转画成有向图（只读可视化 + 点击联动跳转）。
 * 与 Outline 列表互补——列表是当前文件的节点导航，本图是项目级结构总览。
 */
export function StoryGraph({
  program,
  entryPath,
  activeFile,
  activeLine,
  onJump,
}: {
  program: ValidatedProgram | null
  entryPath?: string | null
  activeFile?: string | null
  activeLine: number
  onJump: (file: string, line: number) => void
}) {
  const graph = useMemo(() => buildGraph(program, entryPath ?? null), [program, entryPath])
  const collapsed = graph.nodes.length > COLLAPSE_THRESHOLD
  const lay = useMemo(() => layout(graph, { collapseStitches: collapsed }), [graph, collapsed])

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<Transform>({ tx: 24, ty: 24, scale: 1 })
  const [hovered, setHovered] = useState<string | null>(null)
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // 结构签名：仅 knot/边集合变化才重新 fit（编辑正文不丢平移缩放）。
  const sig = useMemo(() => graph.nodes.map((n) => n.id).join('|') + '#' + graph.edges.length, [graph])

  // 容器尺寸跟踪（ResizeObserver）。
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useMemo(
    () => (w: number, h: number): Transform => {
      if (!lay.width || !lay.height || !w || !h) return { tx: 24, ty: 24, scale: 1 }
      const pad = 48
      const scale = clamp(Math.min((w - pad) / lay.width, (h - pad) / lay.height, 1.2), MIN_SCALE, MAX_SCALE)
      return { tx: (w - lay.width * scale) / 2, ty: (h - lay.height * scale) / 2, scale }
    },
    [lay],
  )

  // 结构或尺寸变化 → 自动适配（仅在有尺寸时；jsdom 无尺寸则保持默认）。
  useEffect(() => {
    if (size.w && size.h) setView(fit(size.w, size.h))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, size.w, size.h])

  // 当前光标行对应的高亮节点/子节点（与 Outline 双向联动一致：最后一个 line ≤ activeLine）。
  const highlightIds = useMemo(() => {
    const ids = new Set<string>()
    if (!activeFile) return ids
    let best: { id: string; knotId: string; line: number } | null = null
    for (const n of graph.nodes) {
      if (n.kind !== 'knot' || n.file !== activeFile) continue
      if (n.line <= activeLine && (!best || n.line > best.line)) best = { id: n.id, knotId: n.id, line: n.line }
      for (const s of n.stitches) {
        if (s.line <= activeLine && (!best || s.line > best.line)) best = { id: s.id, knotId: n.id, line: s.line }
      }
    }
    if (best) {
      ids.add(best.knotId)
      ids.add(best.id)
    }
    return ids
  }, [graph, activeFile, activeLine])

  // hover：高亮相邻 knot + 关联边。
  const hoverKnots = useMemo(() => {
    if (!hovered) return null
    const s = new Set<string>([hovered])
    for (const e of graph.edges) {
      if (!e.resolved) continue
      const a = ownerKnotId(e.from)
      const b = e.to === END_ID ? END_ID : ownerKnotId(e.to)
      if (a === hovered) s.add(b)
      if (b === hovered) s.add(a)
    }
    return s
  }, [hovered, graph.edges])

  // 视口裁剪：只渲染视口（含边距）内的节点/边；无尺寸（测试环境）则全渲染。
  const visible = useMemo(() => cull(lay, view, size), [lay, view, size])

  function onBgPointerDown(e: React.PointerEvent) {
    if ((e.target as Element).closest('.graph-node')) return // 点节点不触发平移
    panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  function onBgPointerMove(e: React.PointerEvent) {
    const p = panRef.current
    if (!p) return
    // 复检主键仍按住：若某次 pointerup 丢失（指针在窗口外释放 / 触发的是 pointercancel），
    // panRef 会残留，此后无按键的普通移动本会误触发平移——这里按无按键即判拖拽结束。
    if (e.buttons === 0) {
      panRef.current = null
      return
    }
    setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }))
  }
  function onBgPointerUp(e: React.PointerEvent) {
    panRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

  function onWheel(e: React.WheelEvent) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      const k = scale / v.scale
      // 保持光标下的世界点不动
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }
    })
  }

  function zoomBy(factor: number) {
    setView((v) => {
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      const cx = size.w / 2
      const cy = size.h / 2
      const k = scale / v.scale
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }
    })
  }

  const empty = graph.nodes.length === 0

  return (
    <div className="story-graph" ref={containerRef}>
      {empty ? (
        <div className="graph-empty">
          {program ? '项目暂无节点结构。' : '修复错误后显示剧情结构图。'}
        </div>
      ) : (
        <svg
          className="graph-svg"
          width="100%"
          height="100%"
          onPointerDown={onBgPointerDown}
          onPointerMove={onBgPointerMove}
          onPointerUp={onBgPointerUp}
          onPointerCancel={onBgPointerUp}
          onWheel={onWheel}
        >
          <defs>
            <marker id="sg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="graph-arrow" />
            </marker>
            <marker id="sg-arrow-choice" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="graph-arrow choice" />
            </marker>
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {visible.edges.map((e) => (
              <path
                key={e.id}
                className={edgeClass(e, hovered)}
                d={edgePath(e)}
                markerEnd={e.resolved ? (e.kind === 'choice' ? 'url(#sg-arrow-choice)' : 'url(#sg-arrow)') : undefined}
              />
            ))}
            {visible.nodes.map((n) => (
              <NodeView
                key={n.id}
                node={n}
                active={highlightIds.has(n.id)}
                activeStitchIds={highlightIds}
                dim={hoverKnots ? !hoverKnots.has(n.id) : false}
                onEnter={() => setHovered(n.id)}
                onLeave={() => setHovered((h) => (h === n.id ? null : h))}
                onJump={onJump}
              />
            ))}
          </g>
        </svg>
      )}

      {!empty && (
        <div className="graph-toolbar" role="toolbar" aria-label="结构图视图控制">
          <button type="button" aria-label="放大" onClick={() => zoomBy(1.2)}>＋</button>
          <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.2)}>－</button>
          <button type="button" aria-label="适配画布" onClick={() => setView(fit(size.w, size.h))}>适配</button>
          <span className="graph-scale" aria-hidden>{Math.round(view.scale * 100)}%</span>
        </div>
      )}
      {collapsed && !empty && (
        <div className="graph-hint">大项目：已折叠 stitch 明细（{graph.nodes.length} 个节点）</div>
      )}
    </div>
  )
}

function NodeView({
  node,
  active,
  activeStitchIds,
  dim,
  onEnter,
  onLeave,
  onJump,
}: {
  node: LaidOutNode
  active: boolean
  activeStitchIds: Set<string>
  dim: boolean
  onEnter: () => void
  onLeave: () => void
  onJump: (file: string, line: number) => void
}) {
  const cls =
    'graph-node' +
    (node.kind === 'end' ? ' end' : '') +
    (node.isEntry ? ' entry' : '') +
    (node.isOpening ? ' opening' : '') +
    (node.unreachable ? ' unreachable' : '') +
    (active ? ' active' : '') +
    (dim ? ' dim' : '')
  const jump = (line: number, file: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.kind === 'end') return
    onJump(file || node.file, line)
  }
  return (
    <g
      className={cls}
      data-node-id={node.id}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={jump(node.line, node.file)}
      role="button"
      tabIndex={0}
    >
      <rect className="graph-node-box" x={node.x} y={node.y} width={node.w} height={node.h} rx={7} />
      <text className="graph-node-title" x={node.x + 10} y={node.y + 19} clipPath="">
        {truncate(node.name, node.kind === 'end' ? 6 : 20)}
      </text>
      {node.laidStitches.map((s) => (
        <g
          key={s.id}
          className={'graph-stitch' + (activeStitchIds.has(s.id) ? ' active' : '')}
          onClick={jump(s.line, s.file)}
        >
          <rect className="graph-stitch-box" x={s.x} y={s.y} width={s.w} height={s.h} rx={3} />
          <text className="graph-stitch-title" x={s.x + 7} y={s.y + s.h - 5}>
            {truncate(s.name, 18)}
          </text>
        </g>
      ))}
    </g>
  )
}

function edgeClass(e: LaidOutEdge, hovered: string | null): string {
  const a = ownerKnotId(e.from)
  const b = e.to === END_ID ? END_ID : ownerKnotId(e.to)
  const inc = hovered != null && (a === hovered || b === hovered)
  return (
    'graph-edge' +
    (e.kind === 'choice' ? ' choice' : '') +
    (e.backEdge ? ' back' : '') +
    (!e.resolved ? ' dangling' : '') +
    (inc ? ' incident' : '')
  )
}

function edgePath(e: LaidOutEdge): string {
  const [p1, p2] = e.points
  if (!p1 || !p2) return ''
  if (e.backEdge) {
    const bow = Math.min(p1.y, p2.y) - 46
    return `M ${p1.x} ${p1.y} C ${p1.x + 46} ${bow} ${p2.x - 46} ${bow} ${p2.x} ${p2.y}`
  }
  const dx = Math.max(28, (p2.x - p1.x) / 2)
  return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y} ${p2.x - dx} ${p2.y} ${p2.x} ${p2.y}`
}

/** 视口裁剪：算出可见世界矩形，过滤节点/边。无尺寸时不裁剪。 */
function cull(lay: GraphLayout, view: Transform, size: { w: number; h: number }): {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
} {
  if (!size.w || !size.h) return { nodes: lay.nodes, edges: lay.edges }
  const margin = 120
  const left = (-view.tx - margin) / view.scale
  const top = (-view.ty - margin) / view.scale
  const right = (size.w - view.tx + margin) / view.scale
  const bottom = (size.h - view.ty + margin) / view.scale
  const inView = (x: number, y: number, w: number, h: number) =>
    x + w >= left && x <= right && y + h >= top && y <= bottom
  const nodes = lay.nodes.filter((n) => inView(n.x, n.y, n.w, n.h))
  const visIds = new Set(nodes.map((n) => n.id))
  const edges = lay.edges.filter((e) => {
    const a = ownerKnotId(e.from)
    const b = e.to === END_ID ? END_ID : ownerKnotId(e.to)
    return visIds.has(a) || visIds.has(b)
  })
  return { nodes, edges }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// 便于类型使用（避免未用告警）。
export type { GraphEdge }
