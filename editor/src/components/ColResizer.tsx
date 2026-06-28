/**
 * 列宽横向拖拽分隔条（绝对定位在某栏的内侧边缘）。
 *
 * 用 pointer 事件实现连续 resize（HTML5 drag API 不适合：有拖影、无连续 move）。
 * 拖拽过程中上报当前指针 clientX，由父组件据此换算成目标列宽（夹紧由父组件做）。
 * 默认几乎隐形，hover / 拖拽时显一条 accent 竖线（styles.css .col-resizer）。
 */
export function ColResizer({
  edge,
  onResize,
  ariaLabel,
}: {
  /** 'right'=贴在本栏右内缘（如资源管理器）；'left'=贴在本栏左内缘（如 AI 面板）。 */
  edge: 'left' | 'right'
  /** 拖拽过程中的指针 clientX；父组件据此换算列宽。 */
  onResize: (clientX: number) => void
  ariaLabel: string
}) {
  return (
    <div
      className={`col-resizer col-resizer-${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = e.currentTarget as any
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
        const move = (ev: PointerEvent) => onResize(ev.clientX)
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
