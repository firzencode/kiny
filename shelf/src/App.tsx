import { useEffect, useRef, useState } from 'react'
import { listLibrary, importKip, openPackage, deleteStory } from './library/store'
import { probeIndexedDB } from './library/db'
import { unzipKip } from './kip/unzipKip'
import { storiesWithAutoSave, readSave, clearStorySaves } from './saves/store'
import { migrateLocalStorageSaves } from './saves/migrate'
import { restoreSave } from './saves/snapshot'
import { AUTO_SAVE_ID } from './saves/types'
import type { LibraryItem } from './library/types'
import { LibraryView, type OpenMode } from './library/LibraryView'
import { loadFromLibrary, type Loaded } from './reading/loadFromLibrary'
import { ReadingView } from './reading/ReadingView'
import type { PlayState } from '@kiny/player'
import type { Story } from '@kiny/engine'

/** `storyId` 缺席 = 临时模式下的书：没落库、没 id，存读档无依附对象。 */
type Reading = { loaded: Loaded; storyId?: string; story: Story; initial?: PlayState }
type View = { kind: 'library' } | { kind: 'reading'; reading: Reading }

const DEFAULT_TITLE = 'Kiny 书架'

/**
 * 书库编排：书架 ↔ 阅读，带续读档。
 * - 书库与存读档同后端（IndexedDB，见 library/store 与 saves/store）：库在存档就在，不存在
 *   「书没了档还在」的孤儿态；localStorage 旧档在探测成功后由 saves/migrate 一次性搬入。
 * - resumable：有 auto 续读档的书 id 集合，决定书架「继续/重新开始」还是「开始」。
 * - 打开互斥：导入/打开经 busyRef 同步互斥（拖放订阅回调读实时值，了结 Phase 2 遗留）。
 * - 资源 objectURL：封面 coverUrlsRef、阅读 urlsRef，刷新/切视图/卸载 revoke。
 * - **临时模式**（degraded）：IndexedDB 不可用（隐私模式 / 老浏览器）时的旁路——不落库，
 *   导入即读、返回即弃、无存读档。正常模式零回归：degraded 为 false 时行为与此前完全一致。
 */
export function App() {
  const [view, setView] = useState<View>({ kind: 'library' })
  const [items, setItems] = useState<LibraryItem[]>([])
  const [resumable, setResumable] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** IndexedDB 不可用 → 临时模式。null = 探测未回（此刻还不知道该渲染书架还是引导页）。 */
  const [degraded, setDegraded] = useState<boolean | null>(null)
  const busyRef = useRef(false) // busy 的同步镜像：拖放订阅闭包读实时值做互斥
  // degraded 的镜像，同理：拖放订阅只挂一次，闭包里的 state 永远停在探测**之前**的值，
  // 只看它会让临时模式下的拖放走进落库路径（必失败）。null 与 state 同义：探测未回。
  const degradedRef = useRef<boolean | null>(null)
  // 探测的 promise：探测窗口内到来的导入等它落定再选路径，免得在这几毫秒里走错路撞出错误横幅。
  const probeRef = useRef<Promise<boolean> | null>(null)
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
      const withAuto = new Set(await storiesWithAutoSave())
      setResumable(new Set(list.filter((i) => withAuto.has(i.id)).map((i) => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载书架失败')
    }
  }

  // 先探测再决定走哪条路：IndexedDB 不可用不报错，切临时模式（书架换成一次性导入引导页）。
  useEffect(() => {
    const probe = probeIndexedDB()
    probeRef.current = probe
    void (async () => {
      const ok = await probe
      degradedRef.current = !ok // ref 早写：探测窗口内到来的导入立刻能选对路径
      // state 晚写：正常模式**等首批书目也就位**才揭幕，否则占位后还要再闪一帧空书架。
      if (ok) {
        // 旧档搬家排在列书之前：否则首屏的「继续」入口会漏掉尚未搬进新库的书。
        // 只在探测成功的分支里跑——降级态下写不进新库，照跑会把 localStorage 里仅存的档也删掉。
        try { await migrateLocalStorageSaves() } catch { /* 搬不动就留在原处，下次启动续搬 */ }
        await refresh()
      }
      setDegraded(!ok)
    })()
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

  /**
   * 临时模式的导入：解压 + 装配后**直接进阅读**，不落库（`importKip` 整条跳过）。
   * 书不留存，返回即弃——故不分配 id、不写存档（`storyId` 缺席即关掉存读档 UI）。
   */
  const importFileEphemeral = async (file: File) => {
    if (busyRef.current) return
    setBusyBoth(true)
    setError(null)
    try {
      const pkg = unzipKip(new Uint8Array(await file.arrayBuffer())) // 坏 zip / 缺 manifest 抛错
      const loaded = loadFromLibrary(pkg) // 装配校验失败即抛，此时尚未建 objectURL
      revoke(urlsRef)
      urlsRef.current = loaded.assetUrls
      document.title = loaded.title
      setView({ kind: 'reading', reading: { loaded, story: loaded.story } })
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusyBoth(false)
    }
  }

  /**
   * 当前该走哪条导入路径（拖放与「导入故事」按钮共用）；读 ref 以便订阅闭包也拿到实时值。
   * 探测尚未落定（ref 为 null，如挂载后立刻拖进一个包）时先等它——否则会默认走落库路径，
   * 在临时模式下必然失败并弹出红色错误横幅，破坏「存不住不是错误」这条设计承诺。
   */
  const doImport = async (file: File) => {
    // `??=`：探测 promise 恒由挂载 effect 先行写入（effect 按声明序跑，拖放订阅挂在它之后），
    // 故这里实际总是复用它；写成每次新建一个 probe 则结果不回写 ref，是条会说谎的恢复路径。
    const degradedNow = degradedRef.current ?? !(await (probeRef.current ??= probeIndexedDB()))
    return degradedNow ? importFileEphemeral(file) : importFile(file)
  }

  // window 级拖放导入：拖入 .kip 走同一 importFile；dragover 必须 preventDefault（否则浏览器当导航打开）。
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.kip'))
      void (async () => { for (const f of files) await doImport(f) })()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void doImport(f)
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
        const save = await readSave(id, AUTO_SAVE_ID)
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
      await clearStorySaves(id) // 连带清该书全部存档，防孤儿残留
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const onBack = () => {
    revoke(urlsRef)
    document.title = DEFAULT_TITLE
    setView({ kind: 'library' })
    // 临时模式无库可刷（书本就没落库、返回即弃），回到导入引导页即可。
    if (!degradedRef.current) void refresh() // 让刚产生/更新的续读档反映到「继续」入口
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
          projectCss={view.reading.loaded.projectCss}
          characters={view.reading.loaded.characters}
          persistent={degraded !== true}
          onBack={onBack}
        />
      ) : degraded === null ? (
        // 探测未回：还不知道该给书架还是引导页。此时渲染书架会先闪一帧「书架还空着」再跳走。
        <div className="app-status" role="status">正在打开书库…</div>
      ) : (
        <>
          <LibraryView
            items={items} resumable={resumable} busy={busy} ephemeral={degraded}
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
