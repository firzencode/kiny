/** 多 tab 栏：打开的文件、活动高亮、未保存点、关闭按钮。 */
export function TabBar({
  openTabs,
  activeFile,
  dirtyMap,
  onSelect,
  onClose,
}: {
  openTabs: string[]
  activeFile: string | null
  dirtyMap: Record<string, boolean>
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
          {dirtyMap[name] && <span className="tab-dirty" aria-hidden />}
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
