import { useEffect, useRef, useState } from 'react'
import { listLibrary, importKip, openPackage, deleteStory } from './library/store'
import { storiesWithAutoSave, readSave, clearStorySaves } from './saves/store'
import { restoreSave } from './saves/snapshot'
import { AUTO_SAVE_ID } from './saves/types'
import type { LibraryItem } from './library/types'
import { LibraryView, type OpenMode } from './library/LibraryView'
import { loadFromLibrary, type Loaded } from './reading/loadFromLibrary'
import { ReadingView } from './reading/ReadingView'
import type { PlayState } from '@kiny/player'
import type { Story } from '@kiny/engine'

type Reading = { loaded: Loaded; storyId: string; story: Story; initial?: PlayState }
type View = { kind: 'library' } | { kind: 'reading'; reading: Reading }

const DEFAULT_TITLE = 'Kiny 书架'

/**
 * 书库编排：书架 ↔ 阅读，带续读档。
 * - 书库持久 IndexedDB；存读档持久 localStorage（saves/store）。
 * - resumable：有 auto 续读档的书 id 集合，决定书架「继续/重新开始」还是「开始」。
 * - 打开互斥：导入/打开经 busyRef 同步互斥（拖放订阅回调读实时值，了结 Phase 2 遗留）。
 * - 资源 objectURL：封面 coverUrlsRef、阅读 urlsRef，刷新/切视图/卸载 revoke。
 */
export function App() {
  const [view, setView] = useState<View>({ kind: 'library' })
  const [items, setItems] = useState<LibraryItem[]>([])
  const [resumable, setResumable] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false) // busy 的同步镜像：拖放订阅闭包读实时值做互斥
  const coverUrlsRef = useRef<string[]>([])
  const urlsRef = useRef<string[]>([])
  const pickRef = useRef<HTMLInputElement>(null)

  const setBusyBoth = (b: boolean) => { busyRef.current = b; setBusy(b) }
  const revoke = (ref: React.MutableRefObject<string[]>) => {
    ref.current.forEach((u) => URL.revokeObjectURL(u))
    ref.current = []
  }

  const refresh = async () => {
    try {
      const list = await listLibrary()
      revoke(coverUrlsRef)
      coverUrlsRef.current = list.map((i) => i.coverUrl).filter((u): u is string => !!u)
      setItems(list)
      const withAuto = new Set(storiesWithAutoSave())
      setResumable(new Set(list.filter((i) => withAuto.has(i.id)).map((i) => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载书架失败')
    }
  }

  useEffect(() => {
    void refresh()
    return () => { revoke(coverUrlsRef); revoke(urlsRef) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const importFile = async (file: File) => {
    if (busyRef.current) return
    setBusyBoth(true)
    setError(null)
    try {
      await importKip(new Uint8Array(await file.arrayBuffer()))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusyBoth(false)
    }
  }

  // window 级拖放导入：拖入 .kip 走同一 importFile；dragover 必须 preventDefault（否则浏览器当导航打开）。
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.kip'))
      void (async () => { for (const f of files) await importFile(f) })()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void importFile(f)
    e.target.value = ''
  }

  const onOpen = async (id: string, mode: OpenMode) => {
    if (busyRef.current) return
    setBusyBoth(true)
    setError(null)
    try {
      const loaded = loadFromLibrary(await openPackage(id))
      let story = loaded.story
      let initial: PlayState | undefined
      if (mode === 'continue') {
        const save = readSave(id, AUTO_SAVE_ID)
        if (save) {
          const res = restoreSave(loaded.program, save)
          if (res.ok) { story = res.story; initial = res.play }
          else setError(
            res.reason === 'fingerprint-mismatch'
              ? '存档对应的故事已更新，已从头开始。'
              : res.reason === 'story-error'
                ? `故事脚本出错：${res.message}`
                : '存档已损坏，已从头开始。',
          )
        }
      }
      revoke(urlsRef)
      urlsRef.current = loaded.assetUrls
      document.title = loaded.title
      setView({ kind: 'reading', reading: { loaded, storyId: id, story, initial } })
    } catch (e) {
      setError(e instanceof Error ? e.message : '打开失败')
    } finally {
      setBusyBoth(false)
    }
  }

  const onDelete = async (id: string) => {
    try {
      await deleteStory(id)
      clearStorySaves(id) // 连带清该书全部存档，防孤儿残留
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const onBack = () => {
    revoke(urlsRef)
    document.title = DEFAULT_TITLE
    setView({ kind: 'library' })
    void refresh() // 让刚产生/更新的续读档反映到「继续」入口
  }

  // 错误提示条顶层渲染（不随书架/阅读切换丢失，对齐 reader）；点击整条关闭。
  return (
    <>
      {error && <div className="toast-error" role="alert" onClick={() => setError(null)}>{error}</div>}
      {view.kind === 'reading' ? (
        <ReadingView
          story={view.reading.story}
          program={view.reading.loaded.program}
          storyId={view.reading.storyId}
          resolveAsset={view.reading.loaded.resolveAsset}
          initial={view.reading.initial}
          title={view.reading.loaded.title}
          onBack={onBack}
        />
      ) : (
        <>
          <LibraryView
            items={items} resumable={resumable} busy={busy}
            onOpen={(id, mode) => void onOpen(id, mode)}
            onDelete={(id) => void onDelete(id)}
            onImport={triggerPick}
          />
          <input
            ref={pickRef} aria-label="导入故事包（.kip）" type="file" accept=".kip"
            onChange={onPick} style={{ display: 'none' }}
          />
        </>
      )}
    </>
  )

  function triggerPick() { pickRef.current?.click() }
}
