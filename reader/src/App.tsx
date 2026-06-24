import { useEffect, useState } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'
import type { Story } from '@kiny/engine'
import { advance, initialState, type PlayState, type ResolveAsset } from '@kiny/player'
import { listLibrary, importKip, deleteStory, pickKipFile } from './library/store'
import { loadStory } from './reading/loadStory'
import { subscribeKipDrop } from './library/importDrop'
import { LibraryView } from './library/LibraryView'
import { ReadingView } from './reading/ReadingView'
import type { LibraryItem } from './types'
import { logErrorEntry, ErrorDetailsDialog, type ErrorSource } from '@kiny/error-report'

type Reading = { story: Story; resolveAsset: ResolveAsset; first: PlayState; title: string }
type View = { kind: 'library' } | { kind: 'reading'; reading: Reading }

export function App() {
  const [items, setItems] = useState<LibraryItem[]>([])
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

  const refresh = () => listLibrary().then(setItems).catch((e) => fail(e, 'operation:listLibrary', '加载书架失败'))
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

  async function openStory(item: LibraryItem) {
    const out = await loadStory(item.dir)
    if (!out.ok) { logErrorEntry({ source: 'operation:openStory', message: out.message }); setError(out.message); return }
    try {
      // 在用户手势内算首帧（StrictMode 安全 + 尽量解锁音频）
      const first = advance(out.story, initialState, out.resolveAsset).state
      setView({ kind: 'reading', reading: { story: out.story, resolveAsset: out.resolveAsset, first, title: out.title } })
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

  if (view.kind === 'reading') {
    return <ReadingView {...view.reading} onBack={() => setView({ kind: 'library' })} />
  }
  return (
    <>
      {error && (
        <div className="toast-error">
          <span onClick={() => setError(null)}>{error}</span>
          <button className="toast-error-details" onClick={() => setShowErrorDetails(true)}>查看详情</button>
        </div>
      )}
      <ErrorDetailsDialog open={showErrorDetails} onClose={() => setShowErrorDetails(false)} />
      <LibraryView items={items} busy={busy} onOpen={openStory} onDelete={removeStory} onImport={() => runImport()} />
    </>
  )
}
