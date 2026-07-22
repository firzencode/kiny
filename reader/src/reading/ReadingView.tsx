import { useCallback, useEffect, useRef, useState } from 'react'
import type { Story, ValidatedProgram } from '@kiny/engine'
import { Player, usePlayback, initialState, type PlayState, type ResolveAsset } from '@kiny/player'
import { listSaves, writeSaveSerial, deleteSave, genSaveId } from '../saves/store'
import { captureSave, restoreSave } from '../saves/snapshot'
import { AUTO_SAVE_ID, type SaveRecord } from '../saves/types'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 驱动壳：持 PlayState，点选经 choose 推进 Story（story 放 ref，读档时可整体替换）。
 * 存档：每次到稳定边界（mount / 选择 / 读档后）自动写一条 auto 存档（抗崩溃续读）；
 * 「存档 / 读档」面板可手动存多份、择一读取、删除。storyId 缺省时禁用存档（如纯渲染测试）。
 */
export function ReadingView({
  story, program, storyId, resolveAsset, initial, title, onBack,
}: {
  story: Story
  program?: ValidatedProgram
  storyId?: string
  resolveAsset: ResolveAsset
  /** 起始播放态：缺省 = 从头（逐字揭示开场）；「继续」入口传入续读存档态。 */
  initial?: PlayState
  title: string
  onBack: () => void
}) {
  // 驱动交给 usePlayback（逐行揭示 + stepMode）；读档时整体换 story + 从存档态续。
  const [driven, setDriven] = useState<{ story: Story; initial: PlayState }>({ story, initial: initial ?? initialState })
  const pb = usePlayback(driven.story, resolveAsset, driven.initial)
  const state = pb.state
  const [saves, setSaves] = useState<SaveRecord[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // 一闪而过的轻量提示（如「已存档」），到时自动消失。
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1600)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const refreshSaves = useCallback(() => {
    if (!storyId) return
    listSaves(storyId).then(setSaves).catch(() => {})
  }, [storyId])

  // 写一条存档（捕获当前 story + play），返回是否成功——供 onSaveManual 据实反馈（B5：不再无条件
  // 谎报「已存档」）。serialize 仅在稳定边界可用，非边界抛错 / writeSave IPC 失败均返回 false。
  // 写走 per-story 串行队列（B8：防快速连点时并发写乱序）。
  const putSave = useCallback(
    async (st: PlayState, kind: SaveRecord['kind'], id: string): Promise<boolean> => {
      if (!storyId || st.error) return false
      let save: SaveRecord
      try {
        save = captureSave(driven.story, st, kind, id, Date.now())
      } catch {
        return false // 非稳定边界：serialize 抛错
      }
      try {
        await writeSaveSerial(storyId, save)
        refreshSaves()
        return true
      } catch {
        return false // IPC 写盘失败
      }
    },
    [storyId, refreshSaves, driven.story],
  )

  // 自动存档代表「已提交的阅读位置」：开局写一次、之后每次做选择时写；读档「不」写 auto
  // （故 auto 始终停在最靠前的进度，误读可经它回退）。用 pendingAuto 标记「下个暂停点应写 auto」。
  const pendingAuto = useRef(true)
  useEffect(() => {
    const atPause = state.choices.length > 0 || state.input !== null || state.ended
    if (atPause && pendingAuto.current) {
      pendingAuto.current = false
      void putSave(state, 'auto', AUTO_SAVE_ID) // auto 静默写（失败无需打扰读者，串行队列保序）
    }
  }, [state, putSave])

  // 首次拉存档列表。
  useEffect(() => { refreshSaves() }, [refreshSaves])

  const onChoose = (pos: number) => {
    pendingAuto.current = true // 做选择 = 提交进度 → 抵下个暂停点时前移 auto
    pb.onChoose(pos)
  }

  const onSubmitInput = (text: string) => {
    pendingAuto.current = true // 提交输入 = 推进进度 → 抵下个暂停点时前移 auto
    pb.onSubmitInput(text)
  }

  const onSaveManual = async () => {
    if (!storyId || state.error) return
    const ok = await putSave(state, 'manual', genSaveId())
    showToast(ok ? '已存档' : '存档失败，请稍后重试') // B5：据实反馈，写失败不谎报成功
  }

  const onLoad = (save: SaveRecord) => {
    if (!program) return
    const res = restoreSave(program, save)
    if (!res.ok) {
      setNotice(
        res.reason === 'fingerprint-mismatch'
          ? '该存档对应的故事已更新，无法读取此存档。'
          : res.reason === 'story-error'
            ? `故事脚本出错：${res.message}`
            : '存档已损坏，无法读取。',
      )
      return
    }
    pendingAuto.current = false // 读档不写 auto（auto 停在最靠前进度）
    setDriven({ story: res.story, initial: res.play }) // usePlayback 换档：重置到存档态并落回同一暂停点
    setPanelOpen(false)
  }

  const onDeleteSave = (id: string) => {
    if (!storyId) return
    void deleteSave(storyId, id).then(refreshSaves).catch(() => {})
  }

  // 列表：自动存档置顶，手动存档按时间倒序。
  const ordered = [...saves].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'auto' ? -1 : 1
    return b.meta.timestamp - a.meta.timestamp
  })

  return (
    <div className="reading">
      <div className="reading-bar">
        <button className="back" onClick={onBack}>← 书架</button>
        <span className="title-chip">{title}</span>
        {storyId && (
          <button className="saves-btn" onClick={() => { refreshSaves(); setConfirmDelId(null); setPanelOpen(true) }}>存档 / 读档</button>
        )}
      </div>
      <Player
        state={state}
        sfx={pb.sfx}
        onChoose={onChoose}
        onSubmitInput={onSubmitInput}
        reveal={pb.reveal}
        onContentClick={pb.onContentClick}
      />

      {toast && <div className="reading-toast" role="status">{toast}</div>}

      {panelOpen && storyId && (
        <div className="saves-overlay" onClick={() => setPanelOpen(false)}>
          <div className="saves-panel" role="dialog" aria-label="存档 / 读档" onClick={(e) => { e.stopPropagation(); setConfirmDelId(null) }}>
            <div className="saves-head">
              <h2>存档 / 读档</h2>
              <button className="saves-close" aria-label="关闭" onClick={() => setPanelOpen(false)}>×</button>
            </div>
            <button className="saves-new" onClick={onSaveManual}>＋ 存档当前进度</button>
            {ordered.length === 0 ? (
              <p className="saves-empty">还没有存档。</p>
            ) : (
              <ul className="saves-list">
                {ordered.map((s) => (
                  <li className="saves-row" key={s.id}>
                    <div className="saves-meta">
                      <span className="saves-label">
                        {s.kind === 'auto' && <span className="saves-tag">自动</span>}
                        {s.meta.label}
                      </span>
                      <span className="saves-time">{fmtTime(s.meta.timestamp)}</span>
                    </div>
                    <button className="saves-load" onClick={() => onLoad(s)} disabled={!program}>读取</button>
                    {confirmDelId === s.id ? (
                      <button
                        className="saves-del-confirm"
                        onClick={(e) => { e.stopPropagation(); onDeleteSave(s.id); setConfirmDelId(null) }}
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
      )}
    </div>
  )
}
