import { useEffect, useState } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'
import type { Story, ValidatedProgram } from '@kiny/engine'
import { advance, initialState, type PlayState, type ResolveAsset } from '@kiny/player'
import { listLibrary, importKip, deleteStory, pickKipFile } from './library/store'
import { loadStory } from './reading/loadStory'
import { subscribeKipDrop } from './library/importDrop'
import { LibraryView, type OpenMode } from './library/LibraryView'
import { ReadingView } from './reading/ReadingView'
import { readSave } from './saves/store'
import { restoreSave } from './saves/snapshot'
import { AUTO_SAVE_ID } from './saves/types'
import type { LibraryItem } from './types'
import { logErrorEntry, ErrorDetailsDialog, type ErrorSource } from '@kiny/error-report'

type Reading = { story: Story; program: ValidatedProgram; storyId: string; resolveAsset: ResolveAsset; first: PlayState; title: string }
type View = { kind: 'library' } | { kind: 'reading'; reading: Reading }

export function App() {
  const [items, setItems] = useState<LibraryItem[]>([])
  // 有自动续读存档的书 id 集合，决定书架显示「继续 / 重新开始」还是「开始」。
  const [resumable, setResumable] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>({ kind: 'library' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  /** 设错误提示并记进运行时错误日志（带来源与 stack），便于事后排查。 */
  const fail = (e: unknown, source: ErrorSource, fallback: string) => {
    const msg = e instanceof Error ? e.message : fallback
    logErrorEntry({ source, message: msg, stack: e instanceof Error ? e.stack : undefined })
    setError(msg)
  }

  const refresh = async () => {
    try {
      const list = await listLibrary()
      setItems(list)
      // 标出哪些书有自动续读存档（决定「继续」入口）。
      const flags = await Promise.all(list.map((i) => readSave(i.id, AUTO_SAVE_ID).then((s) => !!s).catch(() => false)))
      setResumable(new Set(list.filter((_, i) => flags[i]).map((i) => i.id)))
    } catch (e) {
      fail(e, 'operation:listLibrary', '加载书架失败')
    }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const un = subscribeKipDrop((paths) => { void runImport(paths[0]) })
    return () => { void un.then((f) => f()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runImport(kipPath?: string) {
    const path = kipPath ?? (await pickKipFile())
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await importKip(path)
      await refresh()
    } catch (e) {
      fail(e, 'operation:importKip', '导入失败')
    } finally {
      setBusy(false)
    }
  }

  async function openStory(item: LibraryItem, mode: OpenMode) {
    const out = await loadStory(item.dir)
    if (!out.ok) { logErrorEntry({ source: 'operation:openStory', message: out.message }); setError(out.message); return }
    const enter = (story: Story, first: PlayState) =>
      setView({ kind: 'reading', reading: { story, program: out.program, storyId: item.id, resolveAsset: out.resolveAsset, first, title: out.title } })
    try {
      if (mode === 'continue') {
        const save = await readSave(item.id, AUTO_SAVE_ID)
        if (save) {
          const res = restoreSave(out.program, save)
          if (res.ok) { enter(res.story, res.play); return }
          // 故事更新过 / 存档损坏：优雅降级，从头开始并提示。
          setError(res.reason === 'fingerprint-mismatch' ? '存档对应的故事已更新，已从头开始。' : '存档已损坏，已从头开始。')
        }
      }
      // 在用户手势内算首帧（StrictMode 安全 + 尽量解锁音频）
      enter(out.story, advance(out.story, initialState, out.resolveAsset).state)
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
