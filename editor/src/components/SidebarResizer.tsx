/**
 * 侧栏内 Explorer / Outline 之间的可拖拽分隔条。
 *
 * 用 pointer 事件实现连续 resize（HTML5 drag API 不适合：有拖影、无连续 move）。
 * 任一面板折叠时 disabled，拖拽无意义。
 * 默认几乎隐形，hover / 拖拽时显一条 accent 横线（styles.css .sidebar-resizer）。
 */
export function SidebarResizer({
  onResize,
  disabled,
}: {
  /** 拖拽过程中累计的 Explorer 高度增量（px）；正值=向下=Explorer 变高。 */
  onResize: (height: number) => void
  disabled?: boolean
}) {
  return (
    <div
      className={'sidebar-resizer' + (disabled ? ' disabled' : '')}
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整资源管理器与节点的占比"
      onPointerDown={(e) => {
        if (disabled) return
        const startY = e.clientY
        const startTop = e.currentTarget.getBoundingClientRect().top
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = e.currentTarget as any
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
        const move = (ev: PointerEvent) => {
          // 目标 Explorer 高度 = 起点（resizer 的 top，即 Explorer 底部）到当前鼠标的位移
          // resizer 原本紧贴 Explorer 底部，所以 startTop ≈ Explorer 当前高度
          onResize(startTop + (ev.clientY - startY))
        }
        const up = (ev: PointerEvent) => {
          el.releasePointerCapture(ev.pointerId)
          el.classList.remove('dragging')
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
