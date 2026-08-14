import { useCallback, useEffect, useRef, useState } from 'react'
import type { Story, ValidatedProgram } from '@kiny/engine'
import {
  Player, usePlayback, initialState, ProjectStyles,
  type PlayState, type ResolveAsset, type CharacterTable,
} from '@kiny/player'
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
 * 「存档 / 读档」面板可手动存多份、择一读取、删除。
 * 存档走 IndexedDB 异步 API：写入经 per-story 串行队列排队（见 saves/serialQueue.ts），
 * 回调可能在组件已卸载后才回来，故一律经 aliveRef 守卫。
 *
 * 存档开关是**单一派生值** `saveKey`（= 可存档时的书 id，否则 undefined）：既要有 storyId
 * （存档挂在书 id 上），又要 persistent。两者分别对应两种「不该存」：纯渲染测试没有 id；
 * 临时模式（IndexedDB 不可用）书本身不持久，存档指针没有依附对象，写了就是孤儿档。
 */
export function ReadingView({
  story, program, storyId, resolveAsset, initial, title, onBack, projectCss = '', persistent = true,
  characters,
}: {
  story: Story
  program?: ValidatedProgram
  storyId?: string
  resolveAsset: ResolveAsset
  /** 起始播放态：缺省 = 从头（逐字揭示开场）；「继续」入口传入续读存档态。 */
  initial?: PlayState
  title: string
  onBack: () => void
  /** 作品前端资源编译出的 css（字体 + 主题）；缺省为无（纯渲染测试）。 */
  projectCss?: string
  /** 这本书是否持久留存；false = 临时模式，隐藏全部存档 UI、不写 auto 存档。缺省 true。 */
  persistent?: boolean
  /** 作品角色表（`characters.json`）；缺省为无（纯渲染测试）。 */
  characters?: CharacterTable
}) {
  const saveKey = persistent ? storyId : undefined
  const [driven, setDriven] = useState<{ story: Story; initial: PlayState }>({ story, initial: initial ?? initialState })
  const pb = usePlayback(driven.story, resolveAsset, driven.initial)
  const state = pb.state
  const [saves, setSaves] = useState<SaveRecord[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1600)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // 卸载守卫：存档 API 转异步后，回调可能在组件已卸载时才回来（读者中途点了「← 书架」）。
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const refreshSaves = useCallback(async () => {
    if (!saveKey) return
    try {
      const list = await listSaves(saveKey)
      if (aliveRef.current) setSaves(list)
    } catch { /* 读列失败：保持原列表 */ }
  }, [saveKey])

  // 写一条存档（捕获当前 story + play），返回是否成功。engine 的 story.serialize 仅在稳定边界
  // 可用，非边界抛错 / writeSaveSerial 抛错（配额满）均返回 false——供 onSaveManual 据实反馈。
  // 注意 false 只代表「真去写了但没成」：「本就不该存」由调用点前置判掉，不走这里。
  const putSave = useCallback(
    async (st: PlayState, kind: SaveRecord['kind'], id: string): Promise<boolean> => {
      if (!saveKey || st.error) return false
      let save: SaveRecord
      try {
        save = captureSave(driven.story, st, kind, id, Date.now(), saveKey)
      } catch {
        return false
      }
      try {
        // 走串行队列：异步化后「单线程即无并发写乱序」的前提失效，快速连点选项时
        // 两次 auto 写入的事务完成顺序无保证，旧态可能后落盘覆盖新态。
        await writeSaveSerial(saveKey, save)
        void refreshSaves()
        return true
      } catch {
        return false
      }
    },
    [saveKey, refreshSaves, driven.story],
  )

  // 自动存档代表「已提交的阅读位置」：开局写一次、之后每次做选择时写；读档「不」写 auto
  // （故 auto 始终停在最靠前的进度，误读可经它回退）。pendingAuto 标记「下个暂停点应写 auto」。
  const pendingAuto = useRef(true)
  useEffect(() => {
    const atPause = state.choices.length > 0 || state.input !== null || state.ended
    if (atPause && pendingAuto.current) {
      pendingAuto.current = false
      // 「本就不存」先于「存失败」判掉：临时模式（saveKey 缺席）压根没打算写 auto，
      // 故事出错时也不写——两者都不是失败。混在一起会让临时模式每到一个暂停点就报一次
      // 假失败，正面推翻「存不住是既定事实、不是出了问题」这条承诺。
      if (!saveKey || state.error) return
      // 真正写入的失败**不再静默**：配额满 / 事务失败时读者若毫无察觉，下次回来进度会悄悄
      // 回退到最后一次成功写入处。措辞区别于手动存档（读者没主动做这个动作）。
      void putSave(state, 'auto', AUTO_SAVE_ID).then((ok) => {
        if (!ok && aliveRef.current) showToast('自动保存进度失败')
      })
    }
  }, [state, saveKey, putSave, showToast])

  useEffect(() => { void refreshSaves() }, [refreshSaves])

  const onChoose = (pos: number) => {
    pendingAuto.current = true
    pb.onChoose(pos)
  }
  const onSubmitInput = (text: string) => {
    pendingAuto.current = true
    pb.onSubmitInput(text)
  }

  const onSaveManual = async () => {
    if (!saveKey || state.error) return
    const ok = await putSave(state, 'manual', genSaveId())
    if (aliveRef.current) showToast(ok ? '已存档' : '存档失败，请稍后重试')
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
    pendingAuto.current = false // 读档不写 auto
    setDriven({ story: res.story, initial: res.play })
    setPanelOpen(false)
  }

  const onDeleteSave = async (id: string) => {
    if (!saveKey) return
    try { await deleteSave(saveKey, id) } catch { /* no-op */ }
    void refreshSaves()
  }

  const ordered = [...saves].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'auto' ? -1 : 1
    return b.meta.timestamp - a.meta.timestamp
  })

  return (
    <div className="reading">
      <ProjectStyles css={projectCss} />
      <div className="reading-bar">
        <button className="back" onClick={onBack}>← 书架</button>
        <span className="title-chip">{title}</span>
        {saveKey && (
          <button className="saves-btn" onClick={() => { void refreshSaves(); setConfirmDelId(null); setPanelOpen(true) }}>存档 / 读档</button>
        )}
      </div>
      <Player
        state={state}
        sfx={pb.sfx}
        onChoose={onChoose}
        onSubmitInput={onSubmitInput}
        reveal={pb.reveal}
        onContentClick={pb.onContentClick}
        characters={characters}
      />

      {toast && <div className="reading-toast" role="status">{toast}</div>}

      {panelOpen && saveKey && (
        <div className="saves-overlay" onClick={() => setPanelOpen(false)}>
          <div className="saves-panel" role="dialog" aria-label="存档 / 读档" onClick={(e) => { e.stopPropagation(); setConfirmDelId(null) }}>
            <div className="saves-head">
              <h2>存档 / 读档</h2>
              <button className="saves-close" aria-label="关闭" onClick={() => setPanelOpen(false)}>×</button>
            </div>
            <button className="saves-new" onClick={() => void onSaveManual()}>＋ 存档当前进度</button>
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
                        onClick={(e) => { e.stopPropagation(); void onDeleteSave(s.id); setConfirmDelId(null) }}
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
