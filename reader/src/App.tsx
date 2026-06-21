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

type Reading = { story: Story; resolveAsset: ResolveAsset; first: PlayState; title: string }
type View = { kind: 'library' } | { kind: 'reading'; reading: Reading }

export function App() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [view, setView] = useState<View>({ kind: 'library' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => listLibrary().then(setItems).catch((e) => setError(String(e)))
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
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  async function openStory(item: LibraryItem) {
    const out = await loadStory(item.dir)
    if (!out.ok) { setError(out.message); return }
    try {
      // 在用户手势内算首帧（StrictMode 安全 + 尽量解锁音频）
      const first = advance(out.story, initialState, out.resolveAsset).state
      setView({ kind: 'reading', reading: { story: out.story, resolveAsset: out.resolveAsset, first, title: out.title } })
    } catch (e) {
      setError(e instanceof Error ? e.message : '打开故事失败')
    }
  }

  async function removeStory(id: string) {
    const yes = await ask('删除后需重新导入 .kip 才能再读。确定删除？', { title: 'Kiny Reader', kind: 'warning' })
    if (!yes) return
    try {
      await deleteStory(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  if (view.kind === 'reading') {
    return <ReadingView {...view.reading} onBack={() => setView({ kind: 'library' })} />
  }
  return (
    <>
      {error && <div className="toast-error" onClick={() => setError(null)}>{error}</div>}
      <LibraryView items={items} busy={busy} onOpen={openStory} onDelete={removeStory} onImport={() => runImport()} />
    </>
  )
}
