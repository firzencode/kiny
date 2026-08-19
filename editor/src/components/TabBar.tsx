/** 多 tab 栏：打开的文件、活动高亮、未保存点、关闭按钮。 */
export function TabBar({
  openTabs,
  activeFile,
  dirtyMap,
  conflictMap = {},
  onSelect,
  onClose,
}: {
  openTabs: string[]
  activeFile: string | null
  dirtyMap: Record<string, boolean>
  /** 冲突 / 删除标记（conflict 或 missing 均记 true）；命中时覆盖显示，优先级高于 dirty 圆点。缺省空表（既有调用方不受影响）。 */
  conflictMap?: Record<string, boolean>
  onSelect: (name: string) => void
  onClose: (name: string) => void
}) {
  return (
    <div className="tabbar" role="tablist">
      {openTabs.map((name) => (
        <div
          key={name}
          className={'tab' + (name === activeFile ? ' active' : '')}
          role="tab"
          aria-selected={name === activeFile}
          onClick={() => onSelect(name)}
        >
          <span className="tab-name">{name}</span>
          {conflictMap[name] ? <span className="tab-conflict" aria-hidden /> : dirtyMap[name] && <span className="tab-dirty" aria-hidden />}
          <button
            className="tab-close"
            aria-label={`关闭 ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              onClose(name)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
