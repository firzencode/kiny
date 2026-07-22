import { useEffect, useRef, useState } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'
import type { Story, ValidatedProgram } from '@kiny/engine'
import { type PlayState, type ResolveAsset } from '@kiny/player'
import { listLibrary, importKip, deleteStory, pickKipFile } from './library/store'
import { loadStory } from './reading/loadStory'
import { subscribeKipDrop } from './library/importDrop'
import { getOpenedUris, subscribeOpened } from './library/openedIntent'
import { LibraryView, type OpenMode } from './library/LibraryView'
import { ReadingView } from './reading/ReadingView'
import { readSave, storiesWithAutoSave } from './saves/store'
import { restoreSave } from './saves/snapshot'
import { AUTO_SAVE_ID } from './saves/types'
import type { LibraryItem } from './types'
import { logErrorEntry, ErrorDetailsDialog, type ErrorSource } from '@kiny/error-report'

type Reading = { story: Story; program: ValidatedProgram; storyId: string; resolveAsset: ResolveAsset; initial?: PlayState; title: string }
type View = { kind: 'library' } | { kind: 'reading'; reading: Reading }

export function App() {
  const [items, setItems] = useState<LibraryItem[]>([])
  // 有自动续读存档的书 id 集合，决定书架显示「继续 / 重新开始」还是「开始」。
  const [resumable, setResumable] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>({ kind: 'library' })
  const [busy, setBusy] = useState(false)
  // busy 的同步镜像：订阅回调（拖放 / 意图，effect 闭包只捕首渲的 busy）用 ref 读实时值做互斥（B9）。
  const busyRef = useRef(false)
  const setBusyBoth = (b: boolean) => { busyRef.current = b; setBusy(b) }
  const [error, setError] = useState<string | null>(null)
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  /** 设错误提示并记进运行时错误日志（带来源与 stack），便于事后排查。
   * Tauri v2 的 invoke 失败时 reject 的是裸字符串（Rust 侧 Result<_, String>），须原样透传诊断。 */
  const fail = (e: unknown, source: ErrorSource, fallback: string) => {
    const msg = typeof e === 'string' && e.trim() !== '' ? e : e instanceof Error ? e.message : fallback
    logErrorEntry({ source, message: msg, stack: e instanceof Error ? e.stack : undefined })
    setError(msg)
  }

  const refresh = async () => {
    try {
      const list = await listLibrary()
      setItems(list)
      // 标出哪些书有自动续读存档（决定「继续」入口）：一次 IPC 取有 auto 存档的 storyId 集合，
      // 与书架交集（消 N+1 read_save，Q3）。探测失败退化为「无可续读」，不阻断书架加载。
      const withAuto = new Set(await storiesWithAutoSave().catch(() => []))
      setResumable(new Set(list.filter((i) => withAuto.has(i.id)).map((i) => i.id)))
    } catch (e) {
      fail(e, 'operation:listLibrary', '加载书架失败')
    }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const un = subscribeKipDrop((paths) => { void runOpened(paths) }) // B2：多文件拖放批量导入（非只第一个）
    return () => { void un.then((f) => f()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Android「打开 / 分享 .kip」意图：冷启动取回 Rust 暂存的 url、运行中订阅新意图。
  // 意图携带的 content:// URI 与桌面路径走同一字节导入（importKip）。桌面永不触发。
  //
  // 冷 / 热两路**统一经 getOpenedUris()** 拉取——它走 Rust `opened_urls`（= `std::mem::take`，取即清空）。
  // 热启动的 emit 只当「有新意图，来重拉」的信号，其 payload **不直接消费**：否则热路径用 emit payload
  // 导入后，Rust state 里那份并行副本无人排空，Android 回收重建 activity 后 App remount 会经冷启动路径
  // 再取到、重复导入（每次新 uuid → 书架重复条目，T068）。统一走 take 入口后 state 天然不残留、remount 空取。
  useEffect(() => {
    const drainAndImport = () => {
      void getOpenedUris().then((uris) => { if (uris.length > 0) void runOpened(uris) })
    }
    drainAndImport() // 冷启动：取回 UI 加载前暂存的 url
    const un = subscribeOpened(() => { drainAndImport() }) // 热启动：收到 emit 即经 take 口重拉
    return () => { void un.then((f) => f()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runImport(kipPath?: string) {
    if (busyRef.current) return // B9：导入/打开互斥，不并发触发
    const path = kipPath ?? (await pickKipFile())
    if (!path) return
    setBusyBoth(true)
    setError(null)
    try {
      await importKip(path)
      await refresh()
    } catch (e) {
      fail(e, 'operation:importKip', '导入失败')
    } finally {
      setBusyBoth(false)
    }
  }

  /** 导入一批 .kip（意图 URI / 桌面拖放路径）：逐个导入（某个失败不影响其余），完成后回书架并刷新。 */
  async function runOpened(uris: string[]) {
    if (busyRef.current || uris.length === 0) return // B9 互斥
    setBusyBoth(true)
    setError(null)
    let lastErr: unknown = null
    try {
      for (const uri of uris) {
        try {
          await importKip(uri)
        } catch (e) {
          lastErr = e
        }
      }
      await refresh()
      if (lastErr) fail(lastErr, 'operation:importKip', '导入失败')
      setView({ kind: 'library' }) // 导入后回书架展示新书
    } finally {
      setBusyBoth(false)
    }
  }

  async function openStory(item: LibraryItem, mode: OpenMode) {
    if (busyRef.current) return // B9：与导入互斥
    setBusyBoth(true)
    try {
      await doOpenStory(item, mode)
    } finally {
      setBusyBoth(false)
    }
  }

  async function doOpenStory(item: LibraryItem, mode: OpenMode) {
    const out = await loadStory(item.dir)
    if (!out.ok) { logErrorEntry({ source: 'operation:openStory', message: out.message }); setError(out.message); return }
    const enter = (story: Story, initial?: PlayState) =>
      setView({ kind: 'reading', reading: { story, program: out.program, storyId: item.id, resolveAsset: out.resolveAsset, initial, title: out.title } })
    try {
      if (mode === 'continue') {
        const save = await readSave(item.id, AUTO_SAVE_ID)
        if (save) {
          const res = restoreSave(out.program, save)
          if (res.ok) { enter(res.story, res.play); return } // 从续读存档态起（已在暂停点）
          // 故事更新过 / 存档损坏：优雅降级，从头开始并提示。
          setError(
            res.reason === 'fingerprint-mismatch'
              ? '存档对应的故事已更新，已从头开始。'
              : res.reason === 'story-error'
                ? `故事脚本出错：${res.message}`
                : '存档已损坏，已从头开始。',
          )
        }
      }
      // 从头开始：首帧推进 + 逐字揭示由 usePlayback 持有（StrictMode 安全）
      enter(out.story)
    } catch (e) {
      fail(e, 'operation:openStory', '打开故事失败')
    }
  }

  async function removeStory(id: string) {
    const yes = await ask('删除后需重新导入 .kip 才能再读。确定删除？', { title: 'Kiny Reader', kind: 'warning' })
    if (!yes) return
    try {
      await deleteStory(id)
      await refresh()
    } catch (e) {
      fail(e, 'operation:deleteStory', '删除失败')
    }
  }

  // 错误提示 / 详情对话框始终渲染（fixed 定位，可叠在阅读屏上）——否则续读降级等
  // 在进入阅读屏后设的提示会因视图切换而看不到。
  return (
    <>
      {error && (
        <div className="toast-error">
          <span onClick={() => setError(null)}>{error}</span>
          <button className="toast-error-details" onClick={() => setShowErrorDetails(true)}>查看详情</button>
        </div>
      )}
      <ErrorDetailsDialog open={showErrorDetails} onClose={() => setShowErrorDetails(false)} />
      {view.kind === 'reading' ? (
        // 返回书架时刷新，让刚产生 / 更新的自动续读存档反映到「继续」入口。
        <ReadingView {...view.reading} onBack={() => { setView({ kind: 'library' }); void refresh() }} />
      ) : (
        <LibraryView items={items} resumable={resumable} busy={busy} onOpen={openStory} onDelete={removeStory} onImport={() => runImport()} />
      )}
    </>
  )
}
