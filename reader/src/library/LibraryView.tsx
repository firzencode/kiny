import type { LibraryItem } from '../types'

function EmptyShelf() {
  return (
    <div className="empty">
      <div className="icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
        </svg>
      </div>
      <h2>书架还空着</h2>
      <p>把作者分发给你的 <span className="kip">.kip</span> 故事包拖进窗口，或点「导入故事」选择文件，就能开始阅读。</p>
    </div>
  )
}

export function LibraryView({
  items, busy, onOpen, onDelete, onImport,
}: {
  items: LibraryItem[]
  busy: boolean
  onOpen: (item: LibraryItem) => void
  onDelete: (id: string) => void
  onImport: () => void
}) {
  return (
    <div className="app">
      <header className="shelfbar">
        <h1>我的书架</h1>
        <span className="count">{items.length} 个故事</span>
        <button className="btn-import" onClick={onImport} disabled={busy}>＋ 导入故事</button>
      </header>
      {items.length === 0 ? (
        <EmptyShelf />
      ) : (
        <div className="shelf">
          <div className="ed-list">
            {items.map((s) => (
              <div className="ed-row" key={s.id} onClick={() => onOpen(s)}>
                {s.coverUrl ? (
                  <div className="ed-cover"><img src={s.coverUrl} alt="" /></div>
                ) : (
                  <div className="ed-cover ph"><span>{[...s.name][0]}</span></div>
                )}
                <div className="ed-body">
                  <div className="ed-top">
                    <span className="ed-title">{s.name}</span>
                    {s.author && <span className="ed-author">{s.author}</span>}
                  </div>
                  {s.description && <p className="ed-desc">{s.description}</p>}
                </div>
                <button className="ed-go" onClick={(e) => { e.stopPropagation(); onOpen(s) }}>▸ 阅读</button>
                <button className="ed-del" title="删除" onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
