import { useState } from 'react'
import type { LibraryItem } from './types'
import { Credit } from '../Credit'

/** 打开方式：从头开始 / 从自动续读存档继续。 */
export type OpenMode = 'start' | 'continue'

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

/**
 * 书架：列出已导入的书（封面/书名/作者/简介）。行点击打开（有 auto 续读档 → 继续，否则开始）；
 * 行内「继续 / 重新开始 / 开始」按钮，删除键 hover 显现（触摸设备常显）+ 行内两步确认
 * （web 无系统对话框，对应 reader 桌面版的 Tauri ask）。拖放导入由 App 在 window 级处理。
 */
export function LibraryView({
  items, resumable, busy, onOpen, onDelete, onImport,
}: {
  items: LibraryItem[]
  resumable: Set<string>
  busy: boolean
  onOpen: (id: string, mode: OpenMode) => void
  onDelete: (id: string) => void
  onImport: () => void
}) {
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)

  return (
    <div className="app">
      <header className="shelfbar">
        <h1>我的书架</h1>
        <span className="count">{items.length} 个故事</span>
        <button type="button" className="btn-import" onClick={onImport} disabled={busy}>＋ 导入故事</button>
      </header>
      {items.length === 0 ? (
        <>
          <EmptyShelf />
          <Credit />
        </>
      ) : (
        <div className="shelf">
          <div className="ed-list">
            {items.map((s) => {
              const canResume = resumable.has(s.id)
              // 行点击：有续读存档 → 继续；否则从头开始。打开前重置删除确认态。
              const openDefault = () => { setConfirmDelId(null); onOpen(s.id, canResume ? 'continue' : 'start') }
              return (
                <div className="ed-row" key={s.id} onClick={openDefault}>
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
                  {canResume ? (
                    <>
                      <button type="button" className="ed-go" onClick={(e) => { e.stopPropagation(); onOpen(s.id, 'continue') }}>▸ 继续</button>
                      <button type="button" className="ed-restart" onClick={(e) => { e.stopPropagation(); onOpen(s.id, 'start') }}>重新开始</button>
                    </>
                  ) : (
                    <button type="button" className="ed-go" onClick={(e) => { e.stopPropagation(); onOpen(s.id, 'start') }}>▸ 开始</button>
                  )}
                  {confirmDelId === s.id ? (
                    <button
                      type="button" className="ed-del-confirm"
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); setConfirmDelId(null) }}
                    >确定删除?</button>
                  ) : (
                    <button
                      type="button" className="ed-del" aria-label="删除"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelId(s.id) }}
                    >🗑</button>
                  )}
                </div>
              )
            })}
          </div>
          <Credit />
        </div>
      )}
    </div>
  )
}
