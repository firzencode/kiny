import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import type { PlayState, ResolveAsset } from '@kiny/player'
import type { FileGateway, Manifest } from './files/gateway'
import { defaultKipName, defaultWebpageDirName, buildProjectData, projectFileName } from './files/gateway'
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
import { ColResizer } from './components/ColResizer'
import { HelpDialog, type HelpScreen } from './components/HelpDialog'
import { ConfirmCloseDialog, type CloseIntent } from './components/ConfirmCloseDialog'
import { ImportConflictDialog, type ConflictChoice } from './components/ImportConflictDialog'
import { basename, destPath, uniqueName } from './files/importAssets'
import { RecoveryDialog } from './components/RecoveryDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ProjectSettingsDialog } from './components/ProjectSettingsDialog'
import { NewProjectDialog } from './components/NewProjectDialog'
import { useAutosave } from './hooks/useAutosave'
import { detectRecoverable, type RecoverableItem } from './state/drafts'
import { loadSettings, saveSettings, applySettingsVars, clampSettings, DEFAULT_SETTINGS, SETTINGS_BOUNDS, type Settings } from './state/settings'
import { AiPanel } from './components/ai/AiPanel'
import { useAiSession, cleanupExpiredChats } from './ai/useAiSession'
import { loadAiConfig, saveAiConfig, isConfigured, type AiConfig } from './ai/aiConfig'
import type { PreviewPort, PreviewSnapshot } from './ai/actions'
import { loadSession, saveSession, resolveSession, listRecentProjects, removeSession } from './state/session'
import { LaunchScreen } from './components/LaunchScreen'
import { logErrorEntry, ErrorDetailsDialog } from '@kiny/error-report'

// 确定性模式的固定种子（默认行为）。随机模式下由 randomSeed() 每次 ↺ 重掷。
const SESSION_SEED = 0x5eed
// 32 位无符号随机种子；与 engine makeRng 的 `n >>> 0` 吻合。
const randomSeed = () => Math.floor(Math.random() * 0x1_0000_0000) >>> 0
const idResolve: ResolveAsset = (n: string) => n

// 窗口逻辑尺寸随「启动页 ↔ workbench」切换调整观感：启动页紧凑（贴合冷启动默认），
// 打开项目后放大到宽敞的编辑尺寸；与 tauri.conf 默认/最小值保持同一量纲。
const LAUNCH_WINDOW = { width: 880, height: 620 }
const WORKBENCH_WINDOW = { width: 1440, height: 900 }

/** 取异常的可读信息（用于「<动作>失败：<具体>」通知）。 */
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
/** 从文件绝对路径派生父目录（跨平台：兼容 / 与 \ 分隔）。 */
const parentDir = (p: string): string => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : p
}

type Theme = 'dark' | 'light'
interface ViewPrefs {
  sidebar: boolean; preview: boolean; highlight: boolean; ai: boolean
  /** 三个面板各自的折叠态（头部 ▾ 控制）。 */
  explorerCollapsed: boolean
  outlineCollapsed: boolean
  diagnosticsCollapsed: boolean
  /** Explorer 面板像素高度（拖拽分隔条设定）；0 表示用 CSS 默认 52%。 */
  explorerHeight: number
  /** 侧栏（资源管理器）列宽 px（横向拖拽设定）。 */
  sidebarWidth: number
  /** AI 面板列宽 px（横向拖拽设定）。 */
  aiWidth: number
  /** 中间区里编辑列占比 0..1（其余给预览列）；拖中线设定，默认 0.5。 */
  editorRatio: number
}
const DEFAULT_VIEW: ViewPrefs = {
  sidebar: true, preview: true, highlight: true, ai: false,
  explorerCollapsed: false, outlineCollapsed: false, diagnosticsCollapsed: false,
  explorerHeight: 0,
  sidebarWidth: 232, aiWidth: 360, editorRatio: 0.5,
}

function loadTheme(): Theme {
  try { return localStorage.getItem('kiny-editor-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function loadView(): ViewPrefs {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem('kiny-editor-view') || '{}') } } catch { return { ...DEFAULT_VIEW } }
}
// 「我的布局」快照：用户显式保存的一份 ViewPrefs；未存过返回 null。
function loadSavedView(): ViewPrefs | null {
  try {
    const raw = localStorage.getItem('kiny-editor-view-saved')
    return raw == null ? null : { ...DEFAULT_VIEW, ...JSON.parse(raw) }
  } catch { return null }
}

// 记忆用户手动调整过的 workbench 窗口尺寸（逻辑像素）；未记过返回 null → 用默认。
const WINDOW_KEY = 'kiny-editor-window'
function loadWorkbenchSize(): { width: number; height: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(WINDOW_KEY) || 'null')
    return v && typeof v.width === 'number' && typeof v.height === 'number' ? { width: v.width, height: v.height } : null
  } catch { return null }
}
function saveWorkbenchSize(width: number, height: number): void {
  try { localStorage.setItem(WINDOW_KEY, JSON.stringify({ width, height })) } catch { /* ignore */ }
}

export function App({ gateway }: { gateway: FileGateway }) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  // 校验产出的符号表（补全 / 跳转用），随 onValidated 更新；与 programRef 并存（ref 供热路径、state 供 EditorPane 反应式回灌）。
  const [program, setProgram] = useState<ValidatedProgram | null>(null)
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
  const [savedView, setSavedView] = useState<ViewPrefs | null>(loadSavedView)
  const hasSavedLayout = savedView !== null
  // 预览随机种子会话态：编辑期恒稳定（recompute 读 seedRef），仅显式 ↺ 重开预览时按设置重掷。
  const [previewSeed, setPreviewSeed] = useState(SESSION_SEED)
  const seedRef = useRef(SESSION_SEED)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadAiConfig)
  useEffect(() => { saveAiConfig(aiConfig) }, [aiConfig])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newFileToken, setNewFileToken] = useState(0)
  const [help, setHelp] = useState<HelpScreen | null>(null)
  const [pendingClose, setPendingClose] = useState<CloseIntent | null>(null)
  // 崩溃恢复提示：重开项目检测到残留草稿（草稿 ≠ 磁盘）时弹出。
  const [recovery, setRecovery] = useState<{ projectDir: string; items: RecoverableItem[] } | null>(null)
  // 导入资源同名冲突：弹三选框；resolver 承接 Promise，选择后回填。
  const [importConflict, setImportConflict] = useState<{ destRel: string } | null>(null)
  const conflictResolver = useRef<((d: { choice: ConflictChoice; applyRest: boolean }) => void) | null>(null)

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
  const loadDirRef = useRef<(dir: string) => Promise<boolean>>(async () => false)
  useEffect(() => { runIdRef.current = state.runId }, [state.runId])
  useEffect(() => { filesRef.current = state.files }, [state.files])
  useEffect(() => { entryRef.current = state.entry }, [state.entry])
  const committedStateRef = useRef(state)
  useEffect(() => { committedStateRef.current = state }, [state])
  const staleRef = useRef(false)

  // 主题 / 视图持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('kiny-editor-theme', theme) } catch { /* ignore */ }
  }, [theme])
  useEffect(() => {
    try { localStorage.setItem('kiny-editor-view', JSON.stringify(view)) } catch { /* ignore */ }
  }, [view])
  useEffect(() => { applySettingsVars(settings); saveSettings(settings) }, [settings])
  // 会话持久化：记住当前项目打开的 tab 集合与活动 tab、项目名（启动页最近项目显示用）
  useEffect(() => {
    if (state.projectDir) saveSession(state.projectDir, state.openTabs, state.activeFile, state.manifest?.name)
  }, [state.projectDir, state.openTabs, state.activeFile, state.manifest?.name])
  // 最近项目：随打开 / 关闭项目（projectDir 变）与失效移除（recentTick）刷新。
  const [recentTick, setRecentTick] = useState(0)
  const recentProjects = useMemo(() => listRecentProjects(), [state.projectDir, recentTick])

  // 派生量
  const active = activeBuffer(state)
  const nodes = useMemo(() => (active ? parseNodes(active.source) : []), [active])
  // 当前文件诊断（喂 EditorPane 画行内波浪线）；跨文件总览仍走 DiagnosticsList。
  const currentDiags = useMemo(
    () => (active ? state.diagnostics.filter((d) => d.file === active.path) : []),
    [state.diagnostics, active],
  )
  const errorCount = state.diagnostics.filter((d) => d.severity === 'error').length
  const warnCount = state.diagnostics.filter((d) => d.severity === 'warning').length

  // 保位重算
  const recompute = useCallback(
    (prog: ValidatedProgram | null, seq: number[], resolve: ResolveAsset, prev: PlayState | null, emitSfx = false): PreviewSnapshot => {
      const start = prog && entryRef.current ? resolveStart(prog, entryRef.current) : null
      const snap = computePreview(prog, start, seedRef.current, seq, resolve, prev)
      setPlay(snap.play); playRef.current = snap.play
      choiceSeqRef.current = snap.choiceSeq
      setStale(snap.stale); staleRef.current = snap.stale
      if (emitSfx) setSfxQueue(snap.sfx) // 仅点选项路径出声；编辑重算不碰队列（保持引用→不重播）
      return snap
    },
    [],
  )

  const previewPort = useMemo<PreviewPort>(() => ({
    snapshot: () => ({ play: playRef.current, stale: staleRef.current, choiceSeq: choiceSeqRef.current }),
    choose: (pos: number) => recompute(programRef.current, [...choiceSeqRef.current, pos], resolveRef.current, playRef.current, true),
    restart: () => recompute(programRef.current, [], resolveRef.current, playRef.current),
  }), [recompute])

  const ai = useAiSession({
    committedStateRef,
    dispatch,
    gateway,
    validator: validatorRef.current,
    preview: previewPort,
    config: aiConfig,
    setNotice,
    projectDir: state.projectDir,
    retentionDays: settings.aiChatRetentionDays,
  })

  // 启动期按日期清理全部项目的过期 AI 对话记录（spec §5），跑一次。
  const chatCleanupRan = useRef(false)
  useEffect(() => {
    if (chatCleanupRan.current) return
    chatCleanupRan.current = true
    void cleanupExpiredChats(gateway, settings.aiChatRetentionDays, Date.now())
  }, [gateway, settings.aiChatRetentionDays])

  // 自动保存恢复草稿：脏缓冲后台写独立草稿（落 app-data，不碰真文件）。
  const draftBuffers = useMemo(() => Object.values(state.files), [state.files])
  const draftSignature = useMemo(
    () => JSON.stringify(draftBuffers.filter((f) => f.dirty).map((f) => [f.path, f.source])),
    [draftBuffers],
  )
  const autosave = useAutosave({
    enabled: settings.autosaveRecovery,
    gateway,
    projectDir: state.projectDir,
    buffers: draftBuffers,
    signature: draftSignature,
    // 恢复对话框待决期间暂停：否则后台对账会把磁盘上待恢复的草稿（缓冲此时全非脏）抹掉。
    paused: recovery !== null,
  })

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
      setProgram(r.program)
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

  const loadDir = async (dir: string): Promise<boolean> => {
    try {
      const proj = await gateway.readProject(dir)
      resolveRef.current = gateway.makeResolveAsset(dir)
      choiceSeqRef.current = []
      playRef.current = null; setPlay(null)
      programRef.current = null; setProgram(null)
      setStale(false); setCaretLine(null); setActiveLine(1); setNotice(null)
      // 会话恢复：用上次记住的 tab，对当前磁盘文件校验降级（删/改名跳过）
      const validPaths = new Set(proj.files.map((f) => f.path))
      const restore = resolveSession(loadSession(dir), validPaths, proj.manifest.entry)
      dispatch({ type: 'project_loaded', project: proj, restore })
      // 崩溃恢复：会话恢复后检测残留草稿（草稿 ≠ 磁盘）→ 弹恢复提示。
      if (settings.autosaveRecovery) {
        const store = await gateway.readDraftStore()
        const diskKin = proj.files.filter((f) => f.isKin).map((f) => ({ path: f.path, source: f.source ?? '' }))
        const items = detectRecoverable(store, dir, diskKin)
        setRecovery(items.length ? { projectDir: dir, items } : null)
      }
      return true
    } catch (e) {
      setNotice(`打开项目失败：${errMsg(e)}`)
      return false
    }
  }

  const onOpenProject = async () => { const d = await gateway.pickProjectFile(); if (d) await loadDir(d) }
  const onNewProject = () => setNewProjectOpen(true)
  const onBrowseNewProject = () => gateway.pickDirectory()
  const onCreateProject = async (parentDir: string, name: string): Promise<string | null> => {
    try {
      const dir = await gateway.newProject(parentDir, name)
      setNewProjectOpen(false)
      await loadDir(dir)
      return null
    } catch (e) {
      return errMsg(e)
    }
  }
  // 从启动页 / 「最近打开」菜单点最近项目：打开失败（目录被移动 / 删除）→ 提示 + 从会话存储移除该失效条目。
  const onOpenRecent = async (dir: string) => {
    if (!(await loadDir(dir))) { removeSession(dir); setRecentTick((t) => t + 1) }
  }
  // 记住最新 loadDir 闭包，供 onOpenProjectFile 事件订阅（一次性订阅、避免 stale）。
  loadDirRef.current = loadDir
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
  // 干净退出（走守卫保存/丢弃后）清空本项目草稿，下次开不误报恢复；清草稿失败不阻断退出。
  const doExit = async () => {
    if (settings.autosaveRecovery && state.projectDir) {
      try { await autosave.clearProjectDrafts(state.projectDir) } catch { /* 清草稿失败不阻断退出 */ }
    }
    try { await gateway.closeWindow() }
    catch (e) { setNotice(`退出失败：${errMsg(e)}`) }
  }
  // 退出守卫：有脏则弹确认框，否则直接退。
  const requestExit = () => {
    if (anyDirty(state)) setPendingClose({ kind: 'exit' })
    else void doExit()
  }

  // 关闭当前项目回到启动页：清本项目残留草稿（同干净退出，避免下次误报崩溃恢复）→ 重置编辑器态。
  const doCloseProject = async () => {
    if (settings.autosaveRecovery && state.projectDir) {
      try { await autosave.clearProjectDrafts(state.projectDir) } catch { /* 清草稿失败不阻断关闭 */ }
    }
    setNotice(null)
    dispatch({ type: 'project_closed' })
    setRecentTick((t) => t + 1)
  }
  // 关闭项目守卫：有脏则弹确认框，否则直接关。
  const requestCloseProject = () => {
    if (anyDirty(state)) setPendingClose({ kind: 'closeProject' })
    else void doCloseProject()
  }

  // 对话框三解析器：消费 pendingClose 后置空。
  const onCloseDialogSave = async () => {
    const intent = pendingClose
    setPendingClose(null)
    if (!intent) return
    if (intent.kind === 'tab') { if (await saveBuffer(intent.path)) dispatch({ type: 'close_tab', path: intent.path }) }
    else if (intent.kind === 'closeProject') { if (await saveAllDirty()) await doCloseProject() }
    else { if (await saveAllDirty()) await doExit() }
  }
  const onCloseDialogDiscard = async () => {
    const intent = pendingClose
    setPendingClose(null)
    if (!intent) return
    if (intent.kind === 'tab') dispatch({ type: 'discard_tab', path: intent.path })
    else if (intent.kind === 'closeProject') await doCloseProject()
    else await doExit()
  }
  const onCloseDialogCancel = () => setPendingClose(null)

  // 恢复提示三态：恢复（载回草稿、标脏，回到正常保存/丢弃流程）/ 丢弃（删草稿、按磁盘打开）。
  const onRecover = () => {
    const r = recovery
    setRecovery(null)
    if (!r) return
    for (const item of r.items) {
      if (item.status === 'missing') continue // 文件已删/改名：降级跳过、不报错
      dispatch({ type: 'open_tab', path: item.path })
      dispatch({ type: 'source_changed', path: item.path, source: item.source })
    }
  }
  const onDiscardRecovery = () => {
    const r = recovery
    setRecovery(null)
    if (r) void autosave.clearProjectDrafts(r.projectDir)
  }

  const dirtyCount = useMemo(() => Object.values(state.files).filter((f) => f.dirty).length, [state.files])

  // OS 窗口 ✕：用 ref 取最新守卫（拿到最新 state/anyDirty），监听器只注册一次。
  const requestExitRef = useRef(requestExit)
  requestExitRef.current = requestExit

  // 设置弹窗开启状态 ref：全局快捷键 onKey 中早退，避免弹窗开启时触发 zoom 等动作污染已提交 settings。
  const settingsOpenRef = useRef(settingsOpen)
  settingsOpenRef.current = settingsOpen
  // 项目设置弹窗同理：打开时拦全局快捷键（含 Ctrl+S），避免在弹窗输入框里误触编辑器动作。
  const projectSettingsOpenRef = useRef(projectSettingsOpen)
  projectSettingsOpenRef.current = projectSettingsOpen
  // 新建项目弹窗同理：打开时拦全局快捷键。
  const newProjectOpenRef = useRef(newProjectOpen)
  newProjectOpenRef.current = newProjectOpen
  useEffect(() => {
    let unlisten: (() => void) | undefined
    gateway
      .onWindowCloseRequest(() => requestExitRef.current())
      .then((u) => { unlisten = u })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
    return () => unlisten?.()
  }, [gateway])
  // OS 双击 / 关联打开 .kiw：single-instance 转发的路径 → 派生父目录 → 打开项目（复用 loadDir 守卫）。
  useEffect(() => {
    let unlisten: (() => void) | undefined
    gateway
      .onOpenProjectFile((path) => { void loadDirRef.current(parentDir(path)) })
      .then((u) => { unlisten = u })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
    return () => unlisten?.()
  }, [gateway])
  // 窗口尺寸随启动页 ↔ workbench 切换调整：仅在 projectDir 的「有↔无」真正翻转时改尺寸并居中，
  // 冷启动首帧（prev==cur==null）不动窗（已是启动页默认尺寸），项目间切换（都非空）也不动。
  const prevProjectDirRef = useRef(state.projectDir)
  useEffect(() => {
    const prev = prevProjectDirRef.current
    const cur = state.projectDir
    if (prev === cur) return
    prevProjectDirRef.current = cur
    // 只在「有项目 ↔ 无项目」边界翻转时调整；项目间切换（都非空）不动窗、不重复居中。
    // 进 workbench 优先用记忆的尺寸（用户上次手动调整的），未记过用默认；回启动页用固定尺寸。
    const size = prev === null && cur !== null ? (loadWorkbenchSize() ?? WORKBENCH_WINDOW) : prev !== null && cur === null ? LAUNCH_WINDOW : null
    if (size) void gateway.setWindowSize(size.width, size.height).catch((e) => console.error('调整窗口尺寸失败', e))
  }, [state.projectDir, gateway])
  // 记忆用户手动调整的 workbench 尺寸：订阅窗口 resize，仅在有项目时落库（启动页固定尺寸不记，
  // 含切回启动页时我们自己触发的程序化 resize）。订阅只建一次。
  useEffect(() => {
    let unlisten: (() => void) | undefined
    gateway
      .onWindowResize((w, h) => { if (committedStateRef.current.projectDir !== null) saveWorkbenchSize(w, h) })
      .then((u) => { unlisten = u })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
    return () => unlisten?.()
  }, [gateway])
  // 冷启动（OS 双击 .kiw 首次拉起）：mount 后主动取走 Rust 暂存的启动路径（emit 会早于订阅而丢，故用拉取）。
  useEffect(() => {
    gateway
      .takeLaunchProject()
      .then((path) => { if (path) void loadDirRef.current(parentDir(path)) })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
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
      if (state.manifest && state.manifestFile && state.entry && (state.entry === from || state.entry.startsWith(`${from}/`))) {
        const newEntry = state.entry === from ? to : to + state.entry.slice(from.length)
        try {
          await gateway.writeManifest(state.projectDir, { ...state.manifest, entry: newEntry }, state.manifestFile)
        } catch {
          setNotice('重命名成功，但写回项目文件失败，请手动修复入口路径')
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
  // 冲突三选：返回 Promise，由对话框按钮回填 resolver。
  const askImportConflict = (destRel: string) =>
    new Promise<{ choice: ConflictChoice; applyRest: boolean }>((resolve) => {
      conflictResolver.current = resolve
      setImportConflict({ destRel })
    })
  const resolveImportConflict = (choice: ConflictChoice, applyRest: boolean) => {
    setImportConflict(null)
    const r = conflictResolver.current
    conflictResolver.current = null
    r?.({ choice, applyRest })
  }
  // 导入资源：选文件 → 逐个拷入 targetDir，遇同名弹三选（可「应用到其余」）→ 新增 asset entry 刷新树。
  const onImportAssets = async (targetDir: string) => {
    if (!state.projectDir) return
    let picks: string[] | null
    try { picks = await gateway.pickImportFiles() } catch (e) { setNotice(`导入失败：${errMsg(e)}`); return }
    if (!picks || picks.length === 0) return
    const existing = new Set(state.entries.map((e) => e.path)) // 现有全部文件路径
    const taken = new Set(existing)                            // 现有 + 本批已导入（唯一名/冲突判定用）
    let applyRest: ConflictChoice | null = null
    let imported = 0
    try {
      for (const src of picks) {
        let destRel = destPath(targetDir, basename(src))
        if (taken.has(destRel)) {
          let choice = applyRest
          if (choice === null) {
            const d = await askImportConflict(destRel)
            choice = d.choice
            if (d.applyRest) applyRest = d.choice
          }
          if (choice === 'skip') continue
          if (choice === 'rename') destRel = uniqueName(destRel, taken)
          // overwrite：沿用 destRel（覆盖）
        }
        await gateway.importAsset(state.projectDir, destRel, src)
        const isNew = !existing.has(destRel)
        taken.add(destRel)
        if (isNew) { dispatch({ type: 'file_created', file: { path: destRel, isKin: false } }); existing.add(destRel) }
        imported++
      }
      if (imported > 0) setNotice(`已导入 ${imported} 个资源`, 'success')
    } catch (e) { setNotice(`导入失败：${errMsg(e)}`) }
  }
  const onAbout = () => setHelp('about')
  const onSyntaxRef = () => setHelp('syntax')
  const onReportIssue = () => setShowErrorDetails(true)
  const onOpenSettings = () => setSettingsOpen(true)
  const onSaveSettings = (next: Settings, nextTheme: Theme, nextAi: AiConfig) => {
    setSettings(clampSettings(next))
    setTheme(nextTheme)
    setAiConfig(nextAi)
    setSettingsOpen(false)
  }
  const onCancelSettings = () => setSettingsOpen(false)
  const onOpenProjectSettings = () => setProjectSettingsOpen(true)
  const onCancelProjectSettings = () => setProjectSettingsOpen(false)
  // 保存项目设置：写 manifest；改项目名时连带 rename manifest 文件（失败即中止、盘无改动）。
  const onSaveProjectSettings = async (draft: Manifest) => {
    const dir = state.projectDir
    const cur = state.manifest
    const curFile = state.manifestFile
    if (!dir || !cur || !curFile) return
    const target = projectFileName(draft.name)
    const renamed = target !== curFile
    try {
      if (renamed) {
        // 目标名已存在（renamePath 带 exists 检查）或 IO 失败 → 抛错，检查在改动之前故盘无改动。
        await gateway.renamePath(dir, curFile, target)
        try {
          await gateway.writeManifest(dir, draft, target)
        } catch {
          // 罕见：rename 已成、write 未成。文件已在新名下（内容仍旧），manifestFile 须跟到 target
          // 避免后续写回旧名；manifest 内容保持 cur（磁盘未更新）。弹窗留驻等重试。
          dispatch({ type: 'manifest_updated', manifest: cur, manifestFile: target })
          setNotice('项目文件已重命名，但写入内容失败，请重试保存')
          return
        }
        dispatch({ type: 'manifest_updated', manifest: draft, manifestFile: target })
      } else {
        await gateway.writeManifest(dir, draft, curFile)
        dispatch({ type: 'manifest_updated', manifest: draft, manifestFile: curFile })
      }
      setProjectSettingsOpen(false)
      setNotice('项目设置已保存', 'success')
    } catch (e) {
      // 含改名目标已存在的冲突：报错、盘无改动、弹窗留驻（draft 保留）。
      setNotice(`保存项目设置失败：${errMsg(e)}`)
    }
  }
  const bumpCodeSize = (delta: number) =>
    setSettings((s) => clampSettings({ ...s, codeSize: s.codeSize + delta }))
  const onZoomIn = () => bumpCodeSize(SETTINGS_BOUNDS.codeSize.step)
  const onZoomOut = () => bumpCodeSize(-SETTINGS_BOUNDS.codeSize.step)
  const onZoomReset = () => setSettings((s) => ({ ...s, codeSize: DEFAULT_SETTINGS.codeSize }))

  // 布局快照：保存当前 view 到「我的布局」槽 / 恢复我的或出厂布局。
  // 恢复统一走 { ...DEFAULT_VIEW, ...target } 合并，保证将来 ViewPrefs 新增字段时旧快照缺的字段自动取默认。
  const onSaveLayout = () => {
    try { localStorage.setItem('kiny-editor-view-saved', JSON.stringify(view)) } catch { /* ignore */ }
    setSavedView(view)
    setNotice('已保存当前布局', 'success')
  }
  const onRestoreMyLayout = () => { if (savedView) setView({ ...DEFAULT_VIEW, ...savedView }) }
  const onRestoreDefaultLayout = () => setView({ ...DEFAULT_VIEW })

  // 全局键盘快捷键：菜单里的 sc 仅是提示文本，这里做真正的绑定（文件类动作）。
  // 编辑类（Ctrl+X/C/V/A）由 textarea 原生处理，不在此重绑，以免冲突/双重执行。
  // 用 ref 取最新 handler，监听器只注册一次；各 handler 自带空操作守卫。
  const shortcutsRef = useRef({ onNewProject, onOpenProject, onSave, onSaveAll, onOpenSettings, onZoomIn, onZoomOut, onZoomReset })
  shortcutsRef.current = { onNewProject, onOpenProject, onSave, onSaveAll, onOpenSettings, onZoomIn, onZoomOut, onZoomReset }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpenRef.current || projectSettingsOpenRef.current || newProjectOpenRef.current) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const a = shortcutsRef.current
      if (k === 's' && e.altKey) { e.preventDefault(); void a.onSaveAll() }
      else if (k === 's') { e.preventDefault(); void a.onSave() }
      else if (k === 'n' && e.shiftKey) { e.preventDefault(); setNewFileToken((t) => t + 1) }
      else if (k === 'n') { e.preventDefault(); void a.onNewProject() }
      else if (k === 'o') { e.preventDefault(); void a.onOpenProject() }
      // 语法帮助 / 设置弹窗随 workbench 挂载：无项目（启动页）时不触发，
      // 否则会置 help/settingsOpen 状态、下次进项目时弹窗意外弹出。
      else if (k === '/') { if (committedStateRef.current.projectDir !== null) { e.preventDefault(); setHelp('syntax') } }
      else if (k === ',') { if (committedStateRef.current.projectDir !== null) { e.preventDefault(); a.onOpenSettings() } }
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
  // ↺ 重开预览：随机模式换新种子、确定性模式回落固定种子；翻设置开关本身不换，下一次 ↺ 才生效。
  const onRestart = () => {
    const nextSeed = settings.previewRandomSeed ? randomSeed() : SESSION_SEED
    seedRef.current = nextSeed
    setPreviewSeed(nextSeed)
    recompute(programRef.current, [], resolveRef.current, playRef.current)
  }

  const dirtyMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const f of Object.values(state.files)) m[f.path] = f.dirty
    return m
  }, [state.files])

  const cols: React.CSSProperties = {
    ['--col-sidebar' as string]: view.sidebar ? `${view.sidebarWidth}px` : '0px',
    // 预览显示时 editor+preview 两条 fr 之和 = 1，正常按比例分；预览隐藏时 editor 必须用 1fr
    // 而非 editorRatio fr——否则孤立的 `<1fr`（如 0.5fr）按 CSS Grid 的 max(1, Σfr) 基数只填一半、右侧留空。
    ['--col-editor' as string]: view.preview ? `${view.editorRatio}fr` : '1fr',
    ['--col-preview' as string]: view.preview ? `${1 - view.editorRatio}fr` : '0px',
    ['--col-ai' as string]: view.ai ? `${view.aiWidth}px` : '0px',
  }

  // 横向拖拽列宽：从指针 clientX 相对 workbench 边缘换算，夹紧到合理区间。
  const onResizeSidebar = (clientX: number) => {
    const wb = document.querySelector('.workbench')?.getBoundingClientRect()
    if (!wb) return
    setView((v) => ({ ...v, sidebarWidth: Math.max(160, Math.min(480, Math.round(clientX - wb.left))) }))
  }
  const onResizeAi = (clientX: number) => {
    const wb = document.querySelector('.workbench')?.getBoundingClientRect()
    if (!wb) return
    setView((v) => ({ ...v, aiWidth: Math.max(260, Math.min(640, Math.round(wb.right - clientX))) }))
  }
  // 拖编辑/预览中线：在「中间区」（去掉左右栏后）按指针位置定编辑占比，夹在 [0.2, 0.8]。
  const onResizeEditorPreview = (clientX: number) => {
    const wb = document.querySelector('.workbench')?.getBoundingClientRect()
    if (!wb) return
    const midLeft = wb.left + (view.sidebar ? view.sidebarWidth : 0)
    const midRight = wb.right - (view.ai ? view.aiWidth : 0)
    const span = midRight - midLeft
    if (span <= 0) return
    const r = (clientX - midLeft) / span
    setView((v) => ({ ...v, editorRatio: Math.max(0.2, Math.min(0.8, r)) }))
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
      {state.projectDir !== null && (
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
        onOpenProjectSettings={onOpenProjectSettings}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        hasSavedLayout={hasSavedLayout}
        onSaveLayout={onSaveLayout}
        onRestoreMyLayout={onRestoreMyLayout}
        onRestoreDefaultLayout={onRestoreDefaultLayout}
        recentProjects={recentProjects}
        onOpenRecent={onOpenRecent}
        onCloseProject={requestCloseProject}
      />
      )}
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
      {/* 常驻（不随 projectDir 分支）：启动页 / workbench 均可触发新建项目（Ctrl+N、启动页按钮、菜单栏）。 */}
      <NewProjectDialog
        open={newProjectOpen}
        onBrowse={onBrowseNewProject}
        onCreate={onCreateProject}
        onCancel={() => setNewProjectOpen(false)}
      />
      {state.projectDir === null ? (
      <LaunchScreen
        theme={theme}
        recent={recentProjects}
        onNewProject={onNewProject}
        onOpenProject={onOpenProject}
        onOpenRecent={onOpenRecent}
      />
      ) : (
      <>
      <div className="workbench" style={cols}>
        {/*
          各面板显式钉在自己的 grid 列（sidebar=1 / editor=2 / preview=3 / ai=4）。
          面板条件渲染，若靠 grid 自动排布，隐藏某面板后其后的子项会顺位落到错误的列轨道
          （如隐藏 sidebar 后 .editor-col 会落进 0px 的 --col-sidebar 轨道被压扁）。显式定位后，
          任一面板显隐都不影响其余面板的落列——隐藏面板的列塌成 0px 且无子项占用。
        */}
        {view.sidebar && (
          <div className="sidebar" style={{ gridColumn: 1 }}>
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
              onImportAssets={onImportAssets}
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
            <ColResizer edge="right" onResize={onResizeSidebar} ariaLabel="调整资源管理器宽度" />
          </div>
        )}
        <div className="editor-col" style={{ gridColumn: 2 }}>
          <TabBar
            openTabs={state.openTabs}
            activeFile={state.activeFile}
            dirtyMap={dirtyMap}
            onSelect={(path) => dispatch({ type: 'set_active', path })}
            onClose={requestCloseTab}
          />
          {active ? (
            <EditorPane
              // 每个文件一个独立 EditorView：切档重挂，撤销历史天然隔离，
              // 避免在文件 B 里 Ctrl+Z 撤回成文件 A 内容、doc 与 React state 串档。
              key={state.activeFile ?? ''}
              ref={editorRef}
              source={active.source}
              onChange={(s) => dispatch({ type: 'source_changed', path: active.path, source: s })}
              caretLine={caretLine}
              onCaretConsumed={() => setCaretLine(null)}
              onCaretMove={setActiveLine}
              onGoto={onJumpDiagnostic}
              diagnostics={currentDiags}
              program={program}
              activeFile={state.activeFile}
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
          {view.preview && <ColResizer edge="right" onResize={onResizeEditorPreview} ariaLabel="调整编辑区与预览占比" />}
        </div>
        {view.preview && <PreviewPane play={play} stale={stale} sfx={sfxQueue} seed={previewSeed} onChoose={onChoosePreview} onRestart={onRestart} style={{ gridColumn: 3 }} />}
        {view.ai && (
          <AiPanel
            configured={isConfigured(aiConfig)}
            model={aiConfig.model}
            turns={ai.turns}
            running={ai.running}
            onSend={ai.send}
            onStop={ai.stop}
            onNewConversation={ai.newConversation}
            conversations={ai.conversations}
            currentId={ai.currentId}
            onSelectConversation={ai.selectConversation}
            onDeleteConversation={ai.deleteConversation}
            onClose={() => setView((v) => ({ ...v, ai: false }))}
            onOpenSettings={() => { setView((v) => ({ ...v, ai: true })); onOpenSettings() }}
            onResize={onResizeAi}
            style={{ gridColumn: 4 }}
          />
        )}
      </div>
      <HelpDialog screen={help} onClose={() => setHelp(null)} />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        theme={theme}
        aiConfig={aiConfig}
        onSave={onSaveSettings}
        onCancel={onCancelSettings}
      />
      <ProjectSettingsDialog
        open={projectSettingsOpen}
        manifest={state.manifest}
        kinFiles={state.fileOrder}
        onSave={onSaveProjectSettings}
        onCancel={onCancelProjectSettings}
      />
      <ConfirmCloseDialog
        intent={pendingClose}
        dirtyCount={dirtyCount}
        onSave={onCloseDialogSave}
        onDiscard={onCloseDialogDiscard}
        onCancel={onCloseDialogCancel}
      />
      <RecoveryDialog
        items={recovery?.items ?? null}
        onRecover={onRecover}
        onDiscard={onDiscardRecovery}
      />
      <ImportConflictDialog
        destRel={importConflict?.destRel ?? null}
        onChoose={resolveImportConflict}
      />
      </>
      )}
    </div>
  )
}
