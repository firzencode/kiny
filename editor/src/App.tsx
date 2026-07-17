import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import type { PlayState, ResolveAsset, InteractionStep } from '@kiny/player'
import type { FileGateway, Manifest } from './files/gateway'
import { defaultKipName, defaultWebpageDirName, buildProjectData, projectFileName } from './files/gateway'
import { editorReducer, initialEditorState, anyDirty, activeBuffer } from './state/editorReducer'
import { useDebouncedValidation, type ValidationOutcome } from './hooks/useDebouncedValidation'
import { createIncrementalValidator } from './validate/validate'
import { computePreview } from './preview/computePreview'
import { usePreviewPlayback, type PreviewPlayback } from './preview/usePreviewPlayback'
import { parseNodes } from './syntax/kin'
import { MenuBar } from './components/MenuBar'
import { Explorer } from './components/Explorer'
import { TabBar } from './components/TabBar'
import { Outline } from './components/Outline'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { StoryGraph } from './components/StoryGraph'
import { normalize as normalizeKey } from './shortcuts/keys'
import { dispatchMap } from './shortcuts/bindings'
import type { CommandId } from './shortcuts/registry'
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
import { loadWorkbenchSize, saveWorkbenchSize, computeLaunchSize, LAUNCH_WINDOW, WORKBENCH_WINDOW } from './state/windowSize'
import { AiPanel } from './components/ai/AiPanel'
import { useAiSession, cleanupExpiredChats } from './ai/useAiSession'
import { loadAiConfig, saveAiConfig, isConfigured, type AiConfig } from './ai/aiConfig'
import type { ActionContext, PreviewPort, PreviewSnapshot } from './ai/actions'
import { useExternalControl } from './ai/externalControl'
import { runExternalControlStart } from './ai/externalControlLifecycle'
import { invoke } from '@tauri-apps/api/core'
import { loadSession, saveSession, resolveSession, listRecentProjects, removeSession } from './state/session'
import { LaunchScreen, type RecentProject } from './components/LaunchScreen'
import { RemoveRecentDialog } from './components/RemoveRecentDialog'
import { logErrorEntry, ErrorDetailsDialog } from '@kiny/error-report'

// 确定性模式的固定种子（默认行为）。随机模式下由 randomSeed() 每次 ↺ 重掷。
const SESSION_SEED = 0x5eed
// 32 位无符号随机种子；与 engine makeRng 的 `n >>> 0` 吻合。
const randomSeed = () => Math.floor(Math.random() * 0x1_0000_0000) >>> 0
const idResolve: ResolveAsset = (n: string) => n

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
  /** 中间区里编辑列占比 0..1（其余给右侧面板列）；拖中线设定，默认 0.5。 */
  editorRatio: number
  /** 右侧面板当前标签页：预览 / 结构图（二者共用同一列，tab 切换，一次只显示一个）。 */
  rightTab: 'preview' | 'graph'
}
const DEFAULT_VIEW: ViewPrefs = {
  sidebar: true, preview: true, highlight: true, ai: false,
  explorerCollapsed: false, outlineCollapsed: false, diagnosticsCollapsed: false,
  explorerHeight: 0,
  sidebarWidth: 232, aiWidth: 360, editorRatio: 0.5,
  rightTab: 'preview',
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

// 记忆用户手动调整过的 workbench 窗口尺寸：读写 + 退化尺寸守卫见 ./state/windowSize。

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
  // 外部控制运行态（T040）：非 null = 服务已起，含端口；随 settings.externalControl 联动 start/stop。
  const [controlInfo, setControlInfo] = useState<{ port: number } | null>(null)
  const controlGenRef = useRef<number | null>(null) // 当前在跑服务的代际号；关闭时据此代际安全地停自己那一代
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
  const interactionSeqRef = useRef<InteractionStep[]>([])
  const playRef = useRef<PlayState | null>(null)
  const resolveRef = useRef<ResolveAsset>(idResolve)
  const runIdRef = useRef(state.runId)
  const filesRef = useRef(state.files)
  const entryRef = useRef<string | null>(null)
  const pendingJumpRef = useRef<{ file: string; line: number } | null>(null)
  const validatorRef = useRef(createIncrementalValidator())
  const loadDirRef = useRef<(dir: string) => Promise<boolean>>(async () => false)
  const enterProjectRef = useRef<(dir: string) => Promise<boolean>>(async () => false)
  // 本窗角色（Tauri 多窗模型 A）：'launch'/'editor' 走独立窗分流，null 走单页 SPA（web / 测试）。
  // 每窗一个固定角色，整生命周期不变，故只读一次。
  const windowMode = useMemo(() => gateway.currentWindowMode(), [gateway])
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
  const [removeTarget, setRemoveTarget] = useState<RecentProject | null>(null)
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
    (prog: ValidatedProgram | null, seq: InteractionStep[], resolve: ResolveAsset, prev: PlayState | null, emitSfx = false): PreviewSnapshot => {
      const start = prog && entryRef.current ? resolveStart(prog, entryRef.current) : null
      const snap = computePreview(prog, start, seedRef.current, seq, resolve, prev)
      setPlay(snap.play); playRef.current = snap.play
      interactionSeqRef.current = snap.interactionSeq
      setStale(snap.stale); staleRef.current = snap.stale
      if (emitSfx) setSfxQueue(snap.sfx) // 仅点选项路径出声；编辑重算不碰队列（保持引用→不重播）
      return snap
    },
    [],
  )

  const onPreviewCommit = useCallback((state: PlayState, sfx: string[]) => {
    setPlay(state); playRef.current = state
    setStale(false); staleRef.current = false
    setSfxQueue(sfx)
  }, [])
  const preview: PreviewPlayback = usePreviewPlayback(onPreviewCommit)

  // AI 动作前先中止在飞的人工打字动画：否则动画后续的 doStep 会覆盖 AI 刚 recompute 出的瞬时态。
  // 不改 AI 自身的瞬时行为——choose/restart 仍直调 recompute；preview.cancel 引用稳定（useCallback([])）。
  const previewPort = useMemo<PreviewPort>(() => ({
    snapshot: () => ({ play: playRef.current, stale: staleRef.current, interactionSeq: interactionSeqRef.current }),
    choose: (pos: number) => { preview.cancel(); return recompute(programRef.current, [...interactionSeqRef.current, { kind: 'choice', pos }], resolveRef.current, playRef.current, true) },
    submitInput: (text: string) => { preview.cancel(); return recompute(programRef.current, [...interactionSeqRef.current, { kind: 'input', text }], resolveRef.current, playRef.current, true) },
    restart: () => { preview.cancel(); return recompute(programRef.current, [], resolveRef.current, playRef.current) },
  }), [recompute, preview.cancel])

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

  // 外部控制（T040）动作层 ctx：与 useAiSession 内部组的 ctx 同款字面量（getState/dispatch/gateway/
  // validator/preview），差别仅在于外部命令逐条串行处理、无需 AI 会话那种「运行中活态镜像」，
  // 直接读已提交 state 即可（committedStateRef 由上方 effect 每次渲染后同步）。
  const externalCtx: ActionContext = useMemo(() => ({
    getState: () => committedStateRef.current,
    dispatch,
    gateway,
    validator: validatorRef.current,
    preview: previewPort,
  }), [committedStateRef, dispatch, gateway, previewPort])

  // 外部控制只在真正的编辑窗（T038 的 'editor' 窗口）参与：启动窗（'launch'）与 web/SPA（null，
  // 无 Tauri、invoke 不可用）都不起服务、不挂处理器——否则启动窗会随共享的 localStorage 设置
  // 二次 invoke('start_external_control')，重复起服务并以空 editor 状态错误应答外部请求。
  const externalControlActive = settings.externalControl && windowMode === 'editor'
  useExternalControl({ ctx: externalCtx, enabled: externalControlActive })

  // 外部控制开关联动：开→起 Rust HTTP 服务（Rust 侧写 control.json，CLI 据此发现端口+token）；
  // 关→代际安全地停服务（Rust 侧删文件）。仅在「本次会话确实起过」时才发 stop（避免冷启动默认关时误调用）。
  // control.json 生命周期由 Rust 持有（文件存在 ⟺ 端口在监听）；start/stop 带代际号，令 dev
  // StrictMode 双挂载下旧代际的补偿 stop 不误杀新代际的 server（详见 externalControlLifecycle.ts）。
  useEffect(() => {
    let cancelled = false
    if (externalControlActive) {
      void (async () => {
        const result = await runExternalControlStart({ invoke, isCancelled: () => cancelled })
        if (result.kind === 'started') {
          controlGenRef.current = result.info.generation
          if (!cancelled) setControlInfo({ port: result.info.port })
        } else if (result.kind === 'error' && !cancelled) {
          // 仅对「本效果仍在生效」的失败弹通知：dev StrictMode 双挂载下，被清理的那一代
          // start 会因自我超代返回良性 error（已被更新的一代取代），此时 cancelled=true，
          // 不该弹「启用失败」误导用户——真正的 bind 失败发生在未被取消的当代，仍会弹。
          setNotice(`启用外部控制失败：${result.message}`)
        }
        // 'cancelled'：runExternalControlStart 内部已发代际安全的补偿 stop（Rust 删文件），此处无需再做。
      })()
    } else if (controlGenRef.current !== null) {
      const gen = controlGenRef.current
      controlGenRef.current = null
      void (async () => {
        try {
          await invoke('stop_external_control', { generation: gen })
        } catch (e) {
          console.error('停止外部控制失败', e)
        } finally {
          if (!cancelled) setControlInfo(null)
        }
      })()
    }
    return () => { cancelled = true }
  }, [externalControlActive])

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
      preview.cancel() // 编辑优先：打断在飞的人工打字动画
      programRef.current = r.program
      setProgram(r.program)
      recompute(r.program, interactionSeqRef.current, resolveRef.current, playRef.current)
    },
    [recompute, preview.cancel],
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
      preview.cancel() // 项目切换/关闭：避免旧项目的动画残留定时器跨项目触发
      interactionSeqRef.current = []
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

  // 进入某项目：模型 A 分流。
  // - 启动窗（'launch'）：先校验项目可读（失效的最近项目在此拦下、不开空窗），再 spawn 编辑窗、关本启动窗。
  // - 编辑窗（'editor'）/ web（null）：就地 loadDir 换项目（无窗口交接）。
  const enterProject = async (dir: string): Promise<boolean> => {
    if (windowMode === 'launch') {
      try { await gateway.readProject(dir) }
      catch (e) { setNotice(`打开项目失败：${errMsg(e)}`); return false }
      try {
        await gateway.openEditorWindow(dir)
        await gateway.closeWindow()
        return true
      } catch (e) { setNotice(`打开编辑窗口失败：${errMsg(e)}`); return false }
    }
    return loadDir(dir)
  }

  const onOpenProject = async () => { const d = await gateway.pickProjectFile(); if (d) await enterProject(d) }
  const onNewProject = () => setNewProjectOpen(true)
  const onBrowseNewProject = () => gateway.pickDirectory()
  const onCreateProject = async (parentDir: string, name: string): Promise<string | null> => {
    try {
      const dir = await gateway.newProject(parentDir, name)
      setNewProjectOpen(false)
      await enterProject(dir)
      return null
    } catch (e) {
      return errMsg(e)
    }
  }
  // 从启动页 / 「最近打开」菜单点最近项目：打开失败（目录被移动 / 删除）→ 提示 + 从会话存储移除该失效条目。
  const onOpenRecent = async (dir: string) => {
    if (!(await enterProject(dir))) { removeSession(dir); setRecentTick((t) => t + 1) }
  }
  // 记住最新 loadDir / enterProject 闭包，供 onOpenProjectFile / takeLaunchProject 事件订阅（一次性订阅、避免 stale）。
  loadDirRef.current = loadDir
  enterProjectRef.current = enterProject
  // 写单个文件缓冲（按 path 取，支持保存非活动 tab）。成功返 true，失败弹 notice 返 false。
  const saveBuffer = async (path: string): Promise<boolean> => {
    const buf = state.files[path]
    if (!state.projectDir || !buf) return false
    const written = buf.source // 捕获实际写盘文本；await 期间的输入由 reducer 按 written 对账保脏
    try { await gateway.writeFile(state.projectDir, path, written); dispatch({ type: 'saved', path, written }); return true }
    catch (e) { setNotice(`保存失败：${errMsg(e)}`); return false }
  }
  // 写回所有脏文件。成功返 true，失败弹 notice 返 false。
  const saveAllDirty = async (): Promise<boolean> => {
    if (!state.projectDir) return false
    try {
      const written: Record<string, string> = {}
      for (const f of Object.values(state.files)) {
        if (f.dirty) { await gateway.writeFile(state.projectDir, f.path, f.source); written[f.path] = f.source }
      }
      dispatch({ type: 'saved_all', written }); return true
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

  // 关闭当前项目回到启动页：清本项目残留草稿（同干净退出，避免下次误报崩溃恢复）。
  // - 编辑窗（'editor'）：开启动窗 → 关本编辑窗（互斥交接，不留空编辑窗）。
  // - web（null）：就地 dispatch project_closed 回启动页（单页 SPA）。
  const doCloseProject = async () => {
    if (settings.autosaveRecovery && state.projectDir) {
      try { await autosave.clearProjectDrafts(state.projectDir) } catch { /* 清草稿失败不阻断关闭 */ }
    }
    setNotice(null)
    if (windowMode === 'editor') {
      try { await gateway.openLaunchWindow() }
      catch (e) { setNotice(`打开启动窗口失败：${errMsg(e)}`); return } // 启动窗没起来则不关本窗，避免无窗
      await gateway.closeWindow().catch((e) => setNotice(`关闭窗口失败：${errMsg(e)}`))
      return
    }
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
  // OS 双击 / 关联打开 .kiw：single-instance 转发的路径 → 派生父目录 → enterProject（模型 A 分流：
  // 启动窗开编辑窗、编辑窗就地换项目、web 原地 loadDir）。
  useEffect(() => {
    let unlisten: (() => void) | undefined
    gateway
      .onOpenProjectFile((path) => { void enterProjectRef.current(parentDir(path)) })
      .then((u) => { unlisten = u })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
    return () => unlisten?.()
  }, [gateway])
  // 窗口尺寸随启动页 ↔ workbench 切换调整（**仅 web / 单页 SPA**，windowMode===null）：Tauri 多窗下
  // 尺寸随窗创建即给定（openLaunchWindow / openEditorWindow），窗内不再翻转。仅在 projectDir 的
  // 「有↔无」真正翻转时改尺寸并居中；冷启动首帧、项目间切换都不动窗。
  const prevProjectDirRef = useRef(state.projectDir)
  useEffect(() => {
    if (windowMode !== null) return // Tauri 多窗：尺寸随窗创建给定，不在窗内翻转
    const prev = prevProjectDirRef.current
    const cur = state.projectDir
    if (prev === cur) return
    prevProjectDirRef.current = cur
    // 只在「有项目 ↔ 无项目」边界翻转时调整；项目间切换（都非空）不动窗、不重复居中。
    // 进 workbench 优先用记忆的尺寸（用户上次手动调整的），未记过用默认；回启动页用固定尺寸。
    const size = prev === null && cur !== null ? (loadWorkbenchSize() ?? WORKBENCH_WINDOW) : prev !== null && cur === null ? LAUNCH_WINDOW : null
    if (size) void gateway.setWindowSize(size.width, size.height).catch((e) => console.error('调整窗口尺寸失败', e))
  }, [state.projectDir, gateway, windowMode])
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
  // 经 enterProject：启动窗下开编辑窗直达项目（不停在启动窗），web 下原地 loadDir。编辑窗自身不跑
  // （它由 ?project 载入，见下方 boot effect），避免与之重复。
  useEffect(() => {
    if (windowMode === 'editor') return
    gateway
      .takeLaunchProject()
      .then((path) => { if (path) void enterProjectRef.current(parentDir(path)) })
      .catch(() => { /* 非 Tauri 环境忽略 */ })
  }, [gateway, windowMode])
  // 启动窗：按屏幕分辨率定固定尺寸并居中（tauri.conf 默认尺寸只是首帧兜底；冷启动与 spawn 的启动窗
  // 都经此对齐到依分辨率算出的尺寸）。启动窗禁止用户最大化 / 调整尺寸由窗口创建选项 resizable/maximizable:false
  // 保证，此处只定尺寸。仅 launch 窗跑一次。
  const launchSizedRef = useRef(false)
  useEffect(() => {
    if (windowMode !== 'launch' || launchSizedRef.current) return
    launchSizedRef.current = true
    void (async () => {
      const monitor = await gateway.currentMonitorSize().catch(() => null)
      const size = monitor ? computeLaunchSize(monitor) : LAUNCH_WINDOW
      await gateway.setWindowSize(size.width, size.height).catch((e) => console.error('调整启动窗尺寸失败', e))
    })()
  }, [gateway, windowMode])
  // 编辑窗启动：从 URL ?project 载入项目。载入失败 / 无 ?project → 不留空编辑窗，回退开启动窗 + 关本窗。
  const editorBootedRef = useRef(false)
  useEffect(() => {
    if (windowMode !== 'editor' || editorBootedRef.current) return
    editorBootedRef.current = true
    const dir = gateway.currentWindowProject()
    void (async () => {
      if (dir !== null && (await loadDirRef.current(dir))) return
      // 启动窗没起来则不关本窗（保留过渡占位，用户可退出/重试），避免零窗口不可恢复——同 doCloseProject。
      try { await gateway.openLaunchWindow() }
      catch (e) { setNotice(`打开启动窗口失败：${errMsg(e)}`); return }
      await gateway.closeWindow().catch(() => { /* 关窗失败无从恢复，静默 */ })
    })()
  }, [gateway, windowMode])

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

  // 全局键盘快捷键：由中央注册表（shortcuts/registry）驱动，查表派发；菜单 sc 与此同源。
  // 编辑类（Ctrl+X/C/V/A）与 editor 域命令（注释）由 CodeMirror 处理，不在此重绑。
  // 命令 handler 与生效绑定放 ref，监听器只注册一次；各 handler 自带空操作 / 项目守卫。
  const commandHandlersRef = useRef<Record<CommandId, () => void>>(null!)
  commandHandlersRef.current = {
    newProject: () => { void onNewProject() },
    openProject: () => { void onOpenProject() },
    newFile: () => setNewFileToken((t) => t + 1),
    save: () => { void onSave() },
    saveAll: () => { void onSaveAll() },
    // 语法帮助 / 设置随 workbench 挂载：无项目（启动页）时不触发，否则下次进项目弹窗意外弹出。
    openSettings: () => { if (committedStateRef.current.projectDir !== null) onOpenSettings() },
    help: () => { if (committedStateRef.current.projectDir !== null) setHelp('syntax') },
    zoomIn: () => onZoomIn(),
    zoomOut: () => onZoomOut(),
    zoomReset: () => onZoomReset(),
    // editor 域 / readonly 命令：全局不派发（CM / 原生处理），占位以满足 Record 完整性。
    toggleComment: () => {}, undo: () => {}, redo: () => {}, cut: () => {}, copy: () => {}, paste: () => {}, selectAll: () => {},
  }
  // 生效的 global 域派发表（组合 → 命令 id），随自定义覆盖更新。
  const globalDispatchRef = useRef<Map<string, CommandId>>(new Map())
  globalDispatchRef.current = dispatchMap('global', settings.shortcuts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpenRef.current || projectSettingsOpenRef.current || newProjectOpenRef.current) return
      const combo = normalizeKey(e)
      if (!combo) return
      const id = globalDispatchRef.current.get(combo)
      if (!id) return
      e.preventDefault()
      commandHandlersRef.current[id]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onJumpDiagnostic = (file: string, line: number) => {
    if (file === state.activeFile) { setCaretLine(line); setActiveLine(line) }
    else { pendingJumpRef.current = { file, line }; dispatch({ type: 'open_tab', path: file }) }
  }

  const onChoosePreview = (pos: number) => {
    const prior = interactionSeqRef.current
    interactionSeqRef.current = [...prior, { kind: 'choice', pos }]
    const prog = programRef.current
    const start = prog && entryRef.current ? resolveStart(prog, entryRef.current) : null
    if (!prog || start === null) { setStale(true); staleRef.current = true; return } // 程序当前无效：冻结，等下次编辑重算恢复有效再读到这个交互序列
    preview.choose(prog, start, seedRef.current, prior, pos, resolveRef.current)
  }
  const onSubmitInputPreview = (text: string) => {
    const prior = interactionSeqRef.current
    interactionSeqRef.current = [...prior, { kind: 'input', text }]
    const prog = programRef.current
    const start = prog && entryRef.current ? resolveStart(prog, entryRef.current) : null
    if (!prog || start === null) { setStale(true); staleRef.current = true; return } // 程序当前无效：冻结，等下次编辑重算恢复
    preview.submit(prog, start, seedRef.current, prior, text, resolveRef.current)
  }
  // ↺ 重开预览：随机模式换新种子、确定性模式回落固定种子；翻设置开关本身不换，下一次 ↺ 才生效。
  const onRestart = () => {
    const nextSeed = settings.previewRandomSeed ? randomSeed() : SESSION_SEED
    seedRef.current = nextSeed
    setPreviewSeed(nextSeed)
    interactionSeqRef.current = []
    const prog = programRef.current
    const start = prog && entryRef.current ? resolveStart(prog, entryRef.current) : null
    if (!prog || start === null) { setStale(true); staleRef.current = true; return }
    preview.restart(prog, start, nextSeed, resolveRef.current)
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

  // 顶层渲染分流（模型 A）：
  // - 编辑窗启动、项目尚未载入完 → 过渡态占位（编辑窗永不停在「无项目」）。
  // - 启动窗，或 web/SPA 且无项目 → LaunchScreen。
  // - 其余（有项目，或编辑窗已载入）→ workbench。
  const editorBooting = windowMode === 'editor' && state.projectDir === null
  const showLaunch = windowMode === 'launch' || (windowMode === null && state.projectDir === null)

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
        shortcuts={settings.shortcuts}
        hasSavedLayout={hasSavedLayout}
        onSaveLayout={onSaveLayout}
        onRestoreMyLayout={onRestoreMyLayout}
        onRestoreDefaultLayout={onRestoreDefaultLayout}
        recentProjects={recentProjects}
        onOpenRecent={onOpenRecent}
        onCloseProject={requestCloseProject}
        controlInfo={controlInfo}
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
      <RemoveRecentDialog
        target={removeTarget}
        onConfirm={() => {
          if (removeTarget) { removeSession(removeTarget.dir); setRecentTick((t) => t + 1) }
          setRemoveTarget(null)
        }}
        onCancel={() => setRemoveTarget(null)}
      />
      {editorBooting ? (
      <div className="editor-booting" role="status">正在打开项目…</div>
      ) : showLaunch ? (
      <LaunchScreen
        theme={theme}
        recent={recentProjects}
        onNewProject={onNewProject}
        onOpenProject={onOpenProject}
        onOpenRecent={onOpenRecent}
        onRemoveRecent={setRemoveTarget}
      />
      ) : (
      <>
      <div className="workbench" style={cols}>
        {/*
          各面板显式钉在自己的 grid 列（sidebar=1 / editor=2 / preview=3 / ai=4）。
          右侧面板列（第 3 列）内含 tab，预览 / 结构图共用，一次显示一个。
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
              shortcuts={settings.shortcuts}
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
          {view.preview && <ColResizer edge="right" onResize={onResizeEditorPreview} ariaLabel="调整编辑区与右侧面板占比" />}
        </div>
        {view.preview && (
          <div className="right-dock" style={{ gridColumn: 3 }}>
            {/* 预览 ⇄ 结构图共用此列，分段按钮切换（一次只显示一个） */}
            <div className="dock-tabs" role="group" aria-label="右侧面板视图">
              <button
                type="button"
                aria-pressed={view.rightTab === 'preview'}
                className={'dock-tab' + (view.rightTab === 'preview' ? ' active' : '')}
                onClick={() => setView((v) => ({ ...v, rightTab: 'preview' }))}
              >
                预览
              </button>
              <button
                type="button"
                aria-pressed={view.rightTab === 'graph'}
                className={'dock-tab' + (view.rightTab === 'graph' ? ' active' : '')}
                onClick={() => setView((v) => ({ ...v, rightTab: 'graph' }))}
              >
                结构图
              </button>
            </div>
            <div className="dock-body">
              {view.rightTab === 'graph' ? (
                <StoryGraph
                  program={program}
                  entryPath={state.entry}
                  activeFile={state.activeFile}
                  activeLine={activeLine}
                  onJump={onJumpDiagnostic}
                />
              ) : (
                <PreviewPane play={play} stale={stale} sfx={sfxQueue} seed={previewSeed} onChoose={onChoosePreview} onSubmitInput={onSubmitInputPreview} onRestart={onRestart}
                  reveal={preview.reveal} onContentClick={preview.onContentClick} />
              )}
            </div>
          </div>
        )}
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
        controlInfo={controlInfo}
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
