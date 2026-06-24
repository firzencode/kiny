import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import type { PlayState, ResolveAsset } from '@kiny/player'
import type { FileGateway } from './files/gateway'
import { defaultKipName, defaultWebpageDirName, buildProjectData } from './files/gateway'
import { editorReducer, initialEditorState, anyDirty, activeBuffer } from './state/editorReducer'
import { useDebouncedValidation, type ValidationOutcome } from './hooks/useDebouncedValidation'
import { createIncrementalValidator } from './validate/validate'
import { computePreview } from './preview/computePreview'
import { parseNodes } from './syntax/kin'
import { MenuBar } from './components/MenuBar'
import { Explorer } from './components/Explorer'
import { TabBar } from './components/TabBar'
import { Outline } from './components/Outline'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { DiagnosticsList } from './components/DiagnosticsList'
import { PreviewPane } from './components/PreviewPane'
import { SidebarResizer } from './components/SidebarResizer'
import { HelpDialog, type HelpScreen } from './components/HelpDialog'
import { ConfirmCloseDialog, type CloseIntent } from './components/ConfirmCloseDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { loadSettings, saveSettings, applySettingsVars, clampSettings, DEFAULT_SETTINGS, SETTINGS_BOUNDS, type Settings } from './state/settings'
import { loadSession, saveSession, resolveSession } from './state/session'
import { logErrorEntry, ErrorDetailsDialog } from '@kiny/error-report'

const SESSION_SEED = 0x5eed
const idResolve: ResolveAsset = (n: string) => n

/** 取异常的可读信息（用于「<动作>失败：<具体>」通知）。 */
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type Theme = 'dark' | 'light'
interface ViewPrefs {
  sidebar: boolean; preview: boolean; highlight: boolean
  /** 三个面板各自的折叠态（头部 ▾ 控制）。 */
  explorerCollapsed: boolean
  outlineCollapsed: boolean
  diagnosticsCollapsed: boolean
  /** Explorer 面板像素高度（拖拽分隔条设定）；0 表示用 CSS 默认 52%。 */
  explorerHeight: number
}
const DEFAULT_VIEW: ViewPrefs = {
  sidebar: true, preview: true, highlight: true,
  explorerCollapsed: false, outlineCollapsed: false, diagnosticsCollapsed: false,
  explorerHeight: 0,
}

function loadTheme(): Theme {
  try { return localStorage.getItem('kiny-editor-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function loadView(): ViewPrefs {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem('kiny-editor-view') || '{}') } } catch { return { ...DEFAULT_VIEW } }
}

export function App({ gateway }: { gateway: FileGateway }) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const [play, setPlay] = useState<PlayState | null>(null)
  const [stale, setStale] = useState(false)
  const [sfxQueue, setSfxQueue] = useState<string[]>([]) // 预览待播一次性音效；仅点选项时更新（编辑重算不出声）
  const [caretLine, setCaretLine] = useState<number | null>(null)
  const [activeLine, setActiveLine] = useState(1)
  // notice 横幅承载瞬时消息；tone 决定着色/语义（默认 error，成功显式传 'success'）。
  const [notice, setNoticeRaw] = useState<{ text: string; tone: 'error' | 'success' } | null>(null)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const setNotice = (msg: string | null, tone: 'error' | 'success' = 'error') => {
    // 错误类 notice 同时记进运行时错误日志，便于事后排查。
    if (msg != null && tone === 'error') logErrorEntry({ source: 'operation:editor', message: msg })
    setNoticeRaw(msg == null ? null : { text: msg, tone })
  }
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [view, setView] = useState<ViewPrefs>(loadView)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newFileToken, setNewFileToken] = useState(0)
  const [help, setHelp] = useState<HelpScreen | null>(null)
  const [pendingClose, setPendingClose] = useState<CloseIntent | null>(null)

  const editorRef = useRef<EditorHandle>(null)

  // 热值放 ref，稳定 onValidated/run identity，避免抖动重置防抖
  const programRef = useRef<ValidatedProgram | null>(null)
  const choiceSeqRef = useRef<number[]>([])
  const playRef = useRef<PlayState | null>(null)
  const resolveRef = useRef<ResolveAsset>(idResolve)
  const runIdRef = useRef(state.runId)
  const filesRef = useRef(state.files)
  const entryRef = useRef<string | null>(null)
  const pendingJumpRef = useRef<{ file: string; line: number } | null>(null)
  const validatorRef = useRef(createIncrementalValidator())
  useEffect(() => { runIdRef.current = state.runId }, [state.runId])
  useEffect(() => { filesRef.current = state.files }, [state.files])
  useEffect(() => { entryRef.current = state.entry }, [state.entry])

  // 主题 / 视图持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('kiny-editor-theme', theme) } catch { /* ignore */ }
  }, [theme])
  useEffect(() => {
    try { localStorage.setItem('kiny-editor-view', JSON.stringify(view)) } catch { /* ignore */ }
  }, [view])
  useEffect(() => { applySettingsVars(settings); saveSettings(settings) }, [settings])
  // 会话持久化：记住当前项目打开的 tab 集合与活动 tab
  useEffect(() => {
    if (state.projectDir) saveSession(state.projectDir, state.openTabs, state.activeFile)
  }, [state.projectDir, state.openTabs, state.activeFile])

  // 派生量
  const active = activeBuffer(state)
  const nodes = useMemo(() => (active ? parseNodes(active.source) : []), [active])
  const errorCount = state.diagnostics.filter((d) => d.severity === 'error').length
  const warnCount = state.diagnostics.filter((d) => d.severity === 'warning').length

  // 保位重算
  const recompute = useCallback(
    (prog: ValidatedProgram | null, seq: number[], resolve: ResolveAsset, prev: PlayState | null, emitSfx = false) => {
      const start = prog && entryRef.current ? resolveStart(prog, entryRef.current) : null
      const snap = computePreview(prog, start, SESSION_SEED, seq, resolve, prev)
      setPlay(snap.play); playRef.current = snap.play
      choiceSeqRef.current = snap.choiceSeq
      setStale(snap.stale)
      if (emitSfx) setSfxQueue(snap.sfx) // 仅点选项路径出声；编辑重算不碰队列（保持引用→不重播）
    },
    [],
  )

  // 防抖校验：跑全部缓冲
  const run = useCallback((rid: number): ValidationOutcome => {
    const files = Object.values(filesRef.current).map((f) => ({ path: f.path, source: f.source }))
    const { diagnostics, program } = validatorRef.current.validate(files)
    return { runId: rid, diagnostics, program }
  }, [])

  const onValidated = useCallback(
    (r: ValidationOutcome) => {
      dispatch({ type: 'validated', runId: r.runId, diagnostics: r.diagnostics })
      if (r.runId !== runIdRef.current) return
      programRef.current = r.program
      recompute(r.program, choiceSeqRef.current, resolveRef.current, playRef.current)
    },
    [recompute],
  )
  useDebouncedValidation(state.runId, run, onValidated, 300)

  // 跨文件诊断跳转后：等活动文件切过去再落光标
  useEffect(() => {
    const pj = pendingJumpRef.current
    if (pj && state.activeFile === pj.file) {
      pendingJumpRef.current = null
      setCaretLine(pj.line)
      setActiveLine(pj.line)
    }
  }, [state.activeFile])

  const loadDir = async (dir: string) => {
    try {
      const proj = await gateway.readProject(dir)
      resolveRef.current = gateway.makeResolveAsset(dir)
      choiceSeqRef.current = []
      playRef.current = null; setPlay(null)
      programRef.current = null
      setStale(false); setCaretLine(null); setActiveLine(1); setNotice(null)
      // 会话恢复：用上次记住的 tab，对当前磁盘文件校验降级（删/改名跳过）
      const validPaths = new Set(proj.files.map((f) => f.path))
      const restore = resolveSession(loadSession(dir), validPaths, proj.manifest.entry)
      dispatch({ type: 'project_loaded', project: proj, restore })
    } catch (e) {
      setNotice(`打开项目失败：${errMsg(e)}`)
    }
  }

  const onOpenProject = async () => { const d = await gateway.pickProjectDir(); if (d) await loadDir(d) }
  const onNewProject = async () => { const d = await gateway.newProject(); if (d) await loadDir(d) }
  // 写单个文件缓冲（按 path 取，支持保存非活动 tab）。成功返 true，失败弹 notice 返 false。
  const saveBuffer = async (path: string): Promise<boolean> => {
    const buf = state.files[path]
    if (!state.projectDir || !buf) return false
    try { await gateway.writeFile(state.projectDir, path, buf.source); dispatch({ type: 'saved', path }); return true }
    catch (e) { setNotice(`保存失败：${errMsg(e)}`); return false }
  }
  // 写回所有脏文件。成功返 true，失败弹 notice 返 false。
  const saveAllDirty = async (): Promise<boolean> => {
    if (!state.projectDir) return false
    try {
      for (const f of Object.values(state.files)) if (f.dirty) await gateway.writeFile(state.projectDir, f.path, f.source)
      dispatch({ type: 'saved_all' }); return true
    } catch (e) { setNotice(`保存失败：${errMsg(e)}`); return false }
  }
  const onSave = () => { if (active) void saveBuffer(active.path) }
  const onSaveAll = () => { void saveAllDirty() }
  const onExportKip = async () => {
    if (!state.projectDir || !state.manifest) return
    if (anyDirty(state)) {
      if (!(await gateway.confirm('导出前需保存全部改动，保存并继续？'))) return
      if (!(await saveAllDirty())) return
    }
    const dest = await gateway.pickSaveKipPath(defaultKipName(state.manifest.name))
    if (dest == null) return
    try {
      await gateway.exportKip(state.projectDir, dest)
      setNotice(`已导出到 ${dest}`, 'success')
    } catch (e) {
      setNotice(`导出失败：${errMsg(e)}`)
    }
  }
  const onExportWebpage = async () => {
    if (!state.projectDir || !state.manifest) return
    if (anyDirty(state)) {
      if (!(await gateway.confirm('导出前需保存全部改动，保存并继续？'))) return
      if (!(await saveAllDirty())) return
    }
    const parent = await gateway.pickExportWebpageDir()
    if (parent == null) return
    const projectData = buildProjectData(state.manifest, Object.values(state.files))
    try {
      const dest = await gateway.exportWebpage(state.projectDir, parent, defaultWebpageDirName(state.manifest.name), projectData)
      setNotice(`已导出到 ${dest}`, 'success')
    } catch (e) {
      setNotice(`导出失败：${errMsg(e)}`)
    }
  }

  // 关 tab 守卫：脏则弹确认框，否则直接关。
  const requestCloseTab = (path: string) => {
    if (state.files[path]?.dirty) setPendingClose({ kind: 'tab', path })
    else dispatch({ type: 'close_tab', path })
  }
  // 真正关闭窗口。destroy 不再触发 onCloseRequested。失败（如缺权限）弹 notice，不静默吞。
  const doExit = async () => {
    try { await gateway.closeWindow() }
    catch (e) { setNotice(`退出失败：${errMsg(e)}`) }
  }
  // 退出守卫：有脏则弹确认框，否则直接退。
  const requestExit = () => {
    if (anyDirty(state)) setPendingClose({ kind: 'exit' })
    else void doExit()
  }

  // 对话框三解析器：消费 pendingClose 后置空。
  const onCloseDialogSave = async () => {
    const intent = pendingClose
    setPendingClose(null)
    if (!intent) return
    if (intent.kind === 'tab') { if (await saveBuffer(intent.path)) dispatch({ type: 'close_tab', path: intent.path }) }
    else { if (await saveAllDirty()) await doExit() }
  }
  const onCloseDialogDiscard = async () => {
    const intent = pendingClose
    setPendingClose(null)
    if (!intent) return
    if (intent.kind === 'tab') dispatch({ type: 'discard_tab', path: intent.path })
    else await doExit()
  }
  const onCloseDialogCancel = () => setPendingClose(null)

  const dirtyCount = useMemo(() => Object.values(state.files).filter((f) => f.dirty).length, [state.files])

  // OS 窗口 ✕：用 ref 取最新守卫（拿到最新 state/anyDirty），监听器只注册一次。
  const requestExitRef = useRef(requestExit)
  requestExitRef.current = requestExit

  // 设置弹窗开启状态 ref：全局快捷键 onKey 中早退，避免弹窗开启时触发 zoom 等动作污染已提交 settings。
  const settingsOpenRef = useRef(settingsOpen)
  settingsOpenRef.current = settingsOpen
  useEffect(() => {
    let unlisten: (() => void) | undefined
    gateway
      .onWindowCloseRequest(() => requestExitRef.current())
      .then((u) => { unlisten = u })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
    return () => unlisten?.()
  }, [gateway])

  const onCreateFile = async (rawName: string) => {
    if (!state.projectDir) return
    try { const entry = await gateway.createFile(state.projectDir, rawName); dispatch({ type: 'file_created', file: entry }) }
    catch (e) { setNotice(`新建文件失败：${errMsg(e)}`) }
  }
  const onCreateFolder = async (relDir: string) => {
    if (!state.projectDir) return
    try { await gateway.createFolder(state.projectDir, relDir); dispatch({ type: 'folder_created', relDir }) }
    catch (e) { setNotice(`新建文件夹失败：${errMsg(e)}`) }
  }
  const onRename = async (from: string, to: string) => {
    if (!state.projectDir || from === to) return
    try {
      await gateway.renamePath(state.projectDir, from, to)
      dispatch({ type: 'path_renamed', from, to })
      if (state.manifest && state.entry && (state.entry === from || state.entry.startsWith(`${from}/`))) {
        const newEntry = state.entry === from ? to : to + state.entry.slice(from.length)
        try {
          await gateway.writeManifest(state.projectDir, { ...state.manifest, entry: newEntry })
        } catch {
          setNotice('重命名成功，但写回 kiny.json 失败，请手动修复入口路径')
        }
      }
    } catch (e) { setNotice(`重命名失败：${errMsg(e)}`) }
  }
  const onDelete = async (path: string) => {
    if (!state.projectDir) return
    if (state.entry && (state.entry === path || state.entry.startsWith(`${path}/`))) { setNotice('入口文件不可删除'); return }
    const ok = await gateway.confirm(`确认删除 ${path}？此操作不可撤销。`)
    if (!ok) return
    try { await gateway.deletePath(state.projectDir, path); dispatch({ type: 'path_deleted', path }) }
    catch (e) { setNotice(`删除失败：${errMsg(e)}`) }
  }
  const onMove = (from: string, toDir: string) => {
    const name = from.slice(from.lastIndexOf('/') + 1)
    void onRename(from, toDir ? `${toDir}/${name}` : name)
  }
  const onAbout = () => setHelp('about')
  const onSyntaxRef = () => setHelp('syntax')
  const onReportIssue = () => setShowErrorDetails(true)
  const onOpenSettings = () => setSettingsOpen(true)
  const onSaveSettings = (next: Settings, th: Theme) => { setSettings(clampSettings(next)); setTheme(th); setSettingsOpen(false) }
  const onCancelSettings = () => setSettingsOpen(false)
  const bumpCodeSize = (delta: number) =>
    setSettings((s) => clampSettings({ ...s, codeSize: s.codeSize + delta }))
  const onZoomIn = () => bumpCodeSize(SETTINGS_BOUNDS.codeSize.step)
  const onZoomOut = () => bumpCodeSize(-SETTINGS_BOUNDS.codeSize.step)
  const onZoomReset = () => setSettings((s) => ({ ...s, codeSize: DEFAULT_SETTINGS.codeSize }))

  // 全局键盘快捷键：菜单里的 sc 仅是提示文本，这里做真正的绑定（文件类动作）。
  // 编辑类（Ctrl+X/C/V/A）由 textarea 原生处理，不在此重绑，以免冲突/双重执行。
  // 用 ref 取最新 handler，监听器只注册一次；各 handler 自带空操作守卫。
  const shortcutsRef = useRef({ onNewProject, onOpenProject, onSave, onSaveAll, onOpenSettings, onZoomIn, onZoomOut, onZoomReset })
  shortcutsRef.current = { onNewProject, onOpenProject, onSave, onSaveAll, onOpenSettings, onZoomIn, onZoomOut, onZoomReset }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpenRef.current) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const a = shortcutsRef.current
      if (k === 's' && e.altKey) { e.preventDefault(); void a.onSaveAll() }
      else if (k === 's') { e.preventDefault(); void a.onSave() }
      else if (k === 'n' && e.shiftKey) { e.preventDefault(); setNewFileToken((t) => t + 1) }
      else if (k === 'n') { e.preventDefault(); void a.onNewProject() }
      else if (k === 'o') { e.preventDefault(); void a.onOpenProject() }
      else if (k === '/') { e.preventDefault(); setHelp('syntax') }
      else if (k === ',') { e.preventDefault(); a.onOpenSettings() }
      else if (k === '=' || k === '+') { e.preventDefault(); a.onZoomIn() }
      else if (k === '-') { e.preventDefault(); a.onZoomOut() }
      else if (k === '0') { e.preventDefault(); a.onZoomReset() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onJumpDiagnostic = (file: string, line: number) => {
    if (file === state.activeFile) { setCaretLine(line); setActiveLine(line) }
    else { pendingJumpRef.current = { file, line }; dispatch({ type: 'open_tab', path: file }) }
  }

  const onChoosePreview = (pos: number) =>
    recompute(programRef.current, [...choiceSeqRef.current, pos], resolveRef.current, playRef.current, true)
  const onRestart = () =>
    recompute(programRef.current, [], resolveRef.current, playRef.current)

  const dirtyMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const f of Object.values(state.files)) m[f.path] = f.dirty
    return m
  }, [state.files])

  const cols: React.CSSProperties = {
    ['--col-sidebar' as string]: view.sidebar ? '232px' : '0px',
    ['--col-preview' as string]: view.preview ? 'minmax(360px, 42%)' : '0px',
  }

  // 拖拽分隔条：设定 Explorer 像素高度，夹在 [130, sidebarH - 105]（CSS 双保险同值）
  const onResizeExplorer = (height: number) => {
    const sidebarEl = document.querySelector('.sidebar')
    const sidebarH = sidebarEl ? sidebarEl.getBoundingClientRect().height : 800
    const h = Math.max(130, Math.min(sidebarH - 105, height))
    setView((v) => ({ ...v, explorerHeight: h }))
  }
  // Explorer 的 flex-basis：未拖拽（0）时不设，沿用 CSS 默认 max-height:52%
  const explorerStyle: React.CSSProperties | undefined = view.explorerHeight > 0
    ? { flexBasis: `${view.explorerHeight}px`, maxHeight: 'none' }
    : undefined

  return (
    <div className="app">
      <MenuBar
        projectName={state.manifest?.name ?? null}
        anyDirty={anyDirty(state)}
        errorCount={errorCount}
        warnCount={warnCount}
        hasProgram={programRef.current != null}
        canSave={active?.dirty ?? false}
        theme={theme}
        view={view}
        onNewProject={onNewProject}
        onOpenProject={onOpenProject}
        onNewFile={() => setNewFileToken((t) => t + 1)}
        onSave={onSave}
        onSaveAll={onSaveAll}
        onExportKip={onExportKip}
        onExportWebpage={onExportWebpage}
        onExit={requestExit}
        onEdit={(cmd) => editorRef.current?.exec(cmd)}
        onSetTheme={setTheme}
        onToggleView={(key) => setView((v) => ({ ...v, [key]: !v[key] }))}
        onSyntaxRef={onSyntaxRef}
        onAbout={onAbout}
        onReportIssue={onReportIssue}
        onOpenSettings={onOpenSettings}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
      />
      {notice && (
        <div
          className={`toolbar-notice ${notice.tone === 'success' ? 'ok' : 'err'}`}
          role={notice.tone === 'success' ? 'status' : 'alert'}
        >
          <span className="toolbar-notice-msg">{notice.text}</span>
          {notice.tone === 'error' && (
            <button className="toolbar-notice-details" onClick={() => setShowErrorDetails(true)}>查看详情</button>
          )}
          <button className="toolbar-notice-close" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
      <ErrorDetailsDialog open={showErrorDetails} onClose={() => setShowErrorDetails(false)} />
      <div className="workbench" style={cols}>
        {view.sidebar && (
          <div className="sidebar">
            <Explorer
              projectName={state.manifest?.name ?? null}
              entries={state.entries}
              emptyDirs={state.emptyDirs}
              dirtyMap={dirtyMap}
              activeFile={state.activeFile}
              entry={state.entry}
              onOpenFile={(path) => dispatch({ type: 'open_tab', path })}
              onCreateFile={onCreateFile}
              newFileFocusToken={newFileToken}
              onRename={onRename}
              onDelete={onDelete}
              onCreateFolder={onCreateFolder}
              onMove={onMove}
              collapsed={view.explorerCollapsed}
              onToggleCollapse={() => setView((v) => ({ ...v, explorerCollapsed: !v.explorerCollapsed }))}
              style={explorerStyle}
            />
            <SidebarResizer
              onResize={onResizeExplorer}
              disabled={view.explorerCollapsed || view.outlineCollapsed}
            />
            <Outline
              nodes={nodes}
              activeLine={activeLine}
              onJump={(line) => { setCaretLine(line); setActiveLine(line) }}
              collapsed={view.outlineCollapsed}
              onToggleCollapse={() => setView((v) => ({ ...v, outlineCollapsed: !v.outlineCollapsed }))}
            />
          </div>
        )}
        <div className="editor-col">
          <TabBar
            openTabs={state.openTabs}
            activeFile={state.activeFile}
            dirtyMap={dirtyMap}
            onSelect={(path) => dispatch({ type: 'set_active', path })}
            onClose={requestCloseTab}
          />
          {active ? (
            <EditorPane
              ref={editorRef}
              source={active.source}
              onChange={(s) => dispatch({ type: 'source_changed', path: active.path, source: s })}
              caretLine={caretLine}
              activeLine={activeLine}
              onCaretMove={setActiveLine}
              highlight={view.highlight}
            />
          ) : (
            <div className="editor-empty">未打开文件</div>
          )}
          <DiagnosticsList
            diagnostics={state.diagnostics}
            onJump={onJumpDiagnostic}
            collapsed={view.diagnosticsCollapsed}
            onToggleCollapse={() => setView((v) => ({ ...v, diagnosticsCollapsed: !v.diagnosticsCollapsed }))}
          />
        </div>
        {view.preview && <PreviewPane play={play} stale={stale} sfx={sfxQueue} onChoose={onChoosePreview} onRestart={onRestart} />}
      </div>
      <HelpDialog screen={help} onClose={() => setHelp(null)} />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        theme={theme}
        onSave={onSaveSettings}
        onCancel={onCancelSettings}
      />
      <ConfirmCloseDialog
        intent={pendingClose}
        dirtyCount={dirtyCount}
        onSave={onCloseDialogSave}
        onDiscard={onCloseDialogDiscard}
        onCancel={onCloseDialogCancel}
      />
    </div>
  )
}
