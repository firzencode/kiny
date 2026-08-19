/**
 * 阅读顶栏：故事名 + 存档/读档 + 重新开始。
 * 不搬 reader / shelf 的 `.reading-bar` 原样——那条栏左侧是「← 书架」，而导出网页是单本、无书架可返回。
 * 高度 52px 与 reader 对齐，`@panel` 侧栏的 `top: 52px` 正好接在它下面。
 */
export function ViewerBar({
  title, onOpenSaves, onRestart,
}: {
  title: string
  onOpenSaves: () => void
  onRestart: () => void
}) {
  return (
    <div className="viewer-bar">
      <span className="viewer-title">{title}</span>
      <button type="button" className="viewer-saves-btn" onClick={onOpenSaves}>存档 / 读档</button>
      <button type="button" className="viewer-restart-btn" onClick={onRestart}>重新开始</button>
    </div>
  )
}
