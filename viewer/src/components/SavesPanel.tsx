import { useState } from 'react'
import type { ViewerSave } from '../load/saves'

/** 时间戳 → 「MM-DD HH:mm」。口径同 reader / shelf。 */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 存档 / 读档面板：纯展示 + 回调，自身不碰存储。
 * 结构、类名与文案与 reader / shelf 的同名面板保持一致——三端读者看到的是同一个东西。
 */
export function SavesPanel({
  saves, onSaveNew, onLoad, onDelete, onClose, notice,
}: {
  saves: ViewerSave[]
  onSaveNew: () => void
  onLoad: (save: ViewerSave) => void
  onDelete: (id: string) => void
  onClose: () => void
  notice: string | null
}) {
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)

  return (
    <div className="saves-overlay" onClick={onClose}>
      <div
        className="saves-panel" role="dialog" aria-label="存档 / 读档"
        onClick={(e) => { e.stopPropagation(); setConfirmDelId(null) }}
      >
        <div className="saves-head">
          <h2>存档 / 读档</h2>
          <button className="saves-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <button className="saves-new" onClick={onSaveNew}>＋ 存档当前进度</button>
        {saves.length === 0 ? (
          <p className="saves-empty">还没有存档。</p>
        ) : (
          <ul className="saves-list">
            {saves.map((s) => (
              <li className="saves-row" key={s.id}>
                <div className="saves-meta">
                  <span className="saves-label">
                    {/* 「谁是 auto」统一按 kind 判——与 saves.ts 的 sortSaves 同一判据，
                        不再用 id === AUTO_SAVE_ID 另开一套（两者理论上恒等，但两套判据本身是隐患）。 */}
                    {s.kind === 'auto' && <span className="saves-tag">自动</span>}
                    {s.meta.label}
                  </span>
                  <span className="saves-time">{fmtTime(s.meta.timestamp)}</span>
                </div>
                <button className="saves-load" onClick={() => onLoad(s)}>读取</button>
                {confirmDelId === s.id ? (
                  <button
                    className="saves-del-confirm"
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id); setConfirmDelId(null) }}
                  >
                    确定删除?
                  </button>
                ) : (
                  <button
                    className="saves-del"
                    aria-label="删除存档"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelId(s.id) }}
                  >
                    🗑
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {notice && <p className="saves-notice" role="alert">{notice}</p>}
      </div>
    </div>
  )
}
