import { useEffect, useRef, useState } from 'react'
import type { Story } from '@kiny/engine'
import { plainText } from '@kiny/engine'
import {
  Player, usePlayback,
  type ResolveAsset, type PlayState, type InteractionStep, type CharacterTable,
} from '@kiny/player'
import {
  AUTO_SAVE_ID, listSaves, writeSave, deleteSave, previewLabel, genSaveId, type ViewerSave,
} from '../load/saves'
import { ViewerBar } from './ViewerBar'
import { SavesPanel } from './SavesPanel'

/**
 * 驱动壳：usePlayback 持有 Story，逐行 step 推进 + 打字机揭示 + stepMode 分派。
 * 首帧推进与 StrictMode 双调用由 usePlayback 内部守卫处理。
 *
 * 存档：本组件持有交互序列 seq 与当前 PlayState，故存档写入与面板组装都归它；
 * 读档要重放建新 Story，只能由 App 做，经 onLoadSave 上抛。
 * 缺 saveKey / seed 时退化为纯播放（单元测试 / 无持久化场景），不改行为。
 */
export function PlayingView({
  story, resolveAsset, initialState, initialSeq, saveKey, seed, onRestart, onLoadSave, characters, title,
}: {
  story: Story
  resolveAsset: ResolveAsset
  initialState?: PlayState
  initialSeq?: InteractionStep[]
  saveKey?: string
  seed?: number
  onRestart?: () => void
  /** 读档：把选中的存档上抛给 App 重放换局；返回 null 表示成功，否则为要展示的失败文案。 */
  onLoadSave?: (save: ViewerSave) => string | null
  characters?: CharacterTable
  /** 故事名（顶栏展示）。 */
  title?: string
}) {
  const pb = usePlayback(story, resolveAsset, initialState)
  const seqRef = useRef<InteractionStep[]>(initialSeq ? [...initialSeq] : [])
  const [panelOpen, setPanelOpen] = useState(false)
  const [saves, setSaves] = useState<ViewerSave[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 交互已发生但还没写盘：等推进抵达下一个暂停点（见下方 pause effect）才真正落 auto 档。
  const pendingAutoRef = useRef(false)

  // 换 story（「重新开始」/ 恢复另一局，App 每次都 createStory 出新实例）→ 重置交互序列到该局的
  // initialSeq。PlayingView 无 key、不重挂载，故 seqRef 不会自动重置——否则重开后首次交互会把新
  // seed 与旧序列一起落盘、刷新恢复到错位置（镜像 usePlayback 的 story-keyed reset）。
  useEffect(() => {
    seqRef.current = initialSeq ? [...initialSeq] : []
    pendingAutoRef.current = false
    setNotice(null)
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    setToast(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps —— 只在 story 换局时重置，initialSeq 取当帧值。
  }, [story])

  // 卸载时把还没触发的 toast 定时器清掉，否则回调会在组件已卸载后调 setToast。
  useEffect(() => () => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
  }, [])

  const showToast = (msg: string) => {
    // 连续两次存档（如手动存档紧跟自动存档）不能让前一个定时器把后一个 toast 提前擦掉。
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, 2400)
  }

  // 写一条存档；返回真实成败，不谎报——调用点各自在写之前先判「本就不该写」（缺 saveKey/seed 的纯
  // 播放场景、脚本已出错的位置）并跳过，只有「确实去写了但没成」（配额满 / localStorage 不可用）才
  // 算 false 并提示读者。若在这里对「不该写」也返回 true，一旦调用点忘了前置判断就会谎报已存档。
  const put = (kind: ViewerSave['kind'], id: string): boolean => {
    if (saveKey === undefined || seed === undefined || pb.state.error) return false
    return writeSave(saveKey, {
      id, kind, seed, seq: seqRef.current,
      meta: { timestamp: Date.now(), label: previewLabel(pb.state) },
    })
  }

  // 自动存档代表「已提交的阅读位置」：交互推进到下一个暂停点（选项 / 输入框 / 结束）才补写，而不是
  // 交互发生的当帧——pb.onChoose 只是发起推进，pb.state 要等 usePlayback 内部逐行 step 完才落定在
  // 新的暂停点；若在交互回调里直接读 pb.state 落 previewLabel，读到的是选择前那一帧，auto 档展示的
  // 位置会滞后一步（同 shelf ReadingView 的 pendingAuto 处理）。读档不写：onLoadSave 直接换局，
  // 换局触发上面的 story reset effect 会把 pendingAutoRef 清掉，不会在这里补写。
  useEffect(() => {
    const atPause = pb.state.choices.length > 0 || pb.state.input !== null || pb.state.ended
    if (atPause && pendingAutoRef.current) {
      pendingAutoRef.current = false
      // 「本就不该写」（缺 saveKey/seed 的纯播放场景、脚本已出错）先于「写失败」判掉：两者都不是
      // 失败，不该弹「自动保存进度失败」吓读者——尤其脚本出错时读者已经看到错误提示，再报一次
      // 假失败只会火上浇油。真正写盘失败（配额满 / 隐私模式）才提示，措辞区别于手动存档（读者
      // 没主动做这个动作），口径同 shelf ReadingView。
      if (saveKey === undefined || seed === undefined || pb.state.error) return
      if (!put('auto', AUTO_SAVE_ID)) showToast('自动保存进度失败')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps —— put/showToast 每次渲染重建，只按 pb.state 变化判断是否补写。
  }, [pb.state])

  const record = (s: InteractionStep) => {
    if (saveKey === undefined || seed === undefined) return
    seqRef.current = [...seqRef.current, s]
    pendingAutoRef.current = true
  }
  const onChoose = (pos: number) => {
    const choice = pb.state.choices[pos]
    if (choice === undefined) return // 无效选项不记（防污染回放序列）
    // 记下选项文案：作者日后调整选项顺序时，重放能按文案找回原选项、续对分支，而不是静默选进另一条。
    record({ kind: 'choice', pos, text: plainText(choice.spans) })
    pb.onChoose(pos)
  }
  const onSubmitInput = (text: string) => {
    if (pb.state.input === null) return
    record({ kind: 'input', text })
    pb.onSubmitInput(text)
  }

  const refresh = () => setSaves(saveKey === undefined ? [] : listSaves(saveKey))

  const openPanel = () => { refresh(); setNotice(null); setPanelOpen(true) }
  const onSaveNew = () => {
    // 脚本出错的位置不可手动存：存下来读回去还是那个错，同 reader / shelf 的 onSaveManual 护栏。
    if (pb.state.error) return
    const ok = put('manual', genSaveId())
    refresh()
    showToast(ok ? '已存档' : '存档失败，请稍后重试')
  }
  const onLoad = (save: ViewerSave) => {
    const err = onLoadSave?.(save) ?? null
    if (err === null) setPanelOpen(false)
    else setNotice(err)
  }
  const onDelete = (id: string) => {
    // 面板本身只在 saveKey 存在时才可能打开（见下方 ViewerBar 的渲染条件），这里到不了 undefined
    // 分支——仍显式判断而非用 `!` 断言，避免今后改了打开路径就悄悄读到 undefined 的 saveKey。
    if (saveKey === undefined) { refresh(); return }
    // 与手动存档、自动存档统一口径：写操作失败不再吞掉，三者都据实提示（此前只有手动存档有提示，
    // 删除与自动存档静默，三种口径并存不合理）。
    const ok = deleteSave(saveKey, id)
    refresh()
    if (!ok) showToast('删除失败，请稍后重试')
  }

  return (
    <>
      {/* 直接内联判断而非提取成 showBar 布尔量：TS 只在条件表达式里窄化 onRestart 的类型，
          抽成变量后 ViewerBar 的 onRestart prop 会报「可能为 undefined」。 */}
      {saveKey !== undefined && onRestart !== undefined && (
        <ViewerBar title={title ?? ''} onOpenSaves={openPanel} onRestart={onRestart} />
      )}
      <Player
        state={pb.state} sfx={pb.sfx} reveal={pb.reveal}
        onChoose={onChoose} onSubmitInput={onSubmitInput} onContentClick={pb.onContentClick}
        characters={characters}
      />
      {toast && <div className="viewer-toast" role="status">{toast}</div>}
      {panelOpen && (
        <SavesPanel
          saves={saves}
          onSaveNew={onSaveNew} onLoad={onLoad} onDelete={onDelete}
          onClose={() => setPanelOpen(false)}
          notice={notice}
        />
      )}
    </>
  )
}
