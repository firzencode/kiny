import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import { discoverAssets, buildProjectCss } from '@kiny/player'
import type { PlayState, ResolveAsset, InteractionStep, AssetIssue } from '@kiny/player'
import type { FileGateway, Manifest } from './files/gateway'
import { defaultKipName, defaultWebpageDirName, buildProjectData, projectFileName, isTextFile } from './files/gateway'
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
import { TodoPanel } from './components/TodoPanel'
import { scanTodos } from './todo/scanTodos'
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
import { underPath, entryAfterRename } from './util/paths'
import { errMsg } from './util/errMsg'
import { useViewPrefs } from './hooks/useViewPrefs'
import type { ThemeState } from './components/SettingsDialog'
import { useWindowLifecycle } from './hooks/useWindowLifecycle'
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
import type { ActionContext, PreviewPort, PreviewSnapshot } from './ai/actions'
import { useExternalControlToggle } from './hooks/useExternalControlToggle'
import { loadSession, saveSession, resolveSession, listRecentProjects, removeSession } from './state/session'
import { LaunchScreen, type RecentProject } from './components/LaunchScreen'
import { RemoveRecentDialog } from './components/RemoveRecentDialog'
import { logErrorEntry, ErrorDetailsDialog } from '@kiny/error-report'

// 确定性模式的固定种子（默认行为）。随机模式下由 randomSeed() 每次 ↺ 重掷。
const SESSION_SEED = 0x5eed
// 32 位无符号随机种子；与 engine makeRng 的 `n >>> 0` 吻合。
const randomSeed = () => Math.floor(Math.random() * 0x1_0000_0000) >>> 0
const idResolve: ResolveAsset = (n: string) => n

/** 作品资源问题 → 作者能懂的一句话（预览栏提示用）。 */
function describeAssetIssue(i: AssetIssue): string {
  switch (i.kind) {
    case 'bad-font-name': return `字体「${i.path}」的族名「${i.family}」含非法字符，未注册（族名只能用字母数字、空格与 . _ -）`
    case 'font-conflict': return `字体族名「${i.family}」重复，按路径序生效的是「${i.path}」`
    case 'font-unresolved': return `字体「${i.path}」无法解析为可用地址，未注册`
    case 'css-unreadable': return `样式「${i.path}」读不到内容，已跳过`
  }
}

// 主题 / 布局偏好（面板显隐·尺寸·「我的布局」）的状态与持久化见 ./hooks/useViewPrefs。
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
  const {
    theme, setPresetTheme, activeThemeId, setActiveThemeId, customThemes, setCustomThemes,
    view, setView, hasSavedLayout,
    onSaveLayout, onRestoreMyLayout, onRestoreDefaultLayout,
    cols, explorerStyle, onResizeSidebar, onResizeAi, onResizeEditorPreview, onResizeExplorer,
  } = useViewPrefs(() => setNotice('已保存当前布局', 'success'))
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
  const { controlInfo } = useExternalControlToggle(
    externalCtx,
    settings.externalControl && windowMode === 'editor',
    setNotice,
  )

  // 启动期按日期清理全部项目的过期 AI 对话记录（spec §5），跑一次。
  const chatCleanupRan = useRef(false)
  useEffect(() => {
    if (chatCleanupRan.current) return
    chatCleanupRan.current = true
    void cleanupExpiredChats(gateway, settings.aiChatRetentionDays, Date.now())
  }, [gateway, settings.aiChatRetentionDays])

  // 自动保存恢复草稿：脏缓冲后台写独立草稿（落 app-data，不碰真文件）。
  const draftBuffers = useMemo(() => Object.values(state.files), [state.files])
  // 待办面板数据（T075）：扫全项目 .kin 的 TODO/FIXME。draftBuffers 已含当前编辑文件的最新 buffer，
  // 故未保存的 // TODO 也即时出现；正则扫描成本极低，随 buffer 变化 useMemo 重算无压力。
  const todos = useMemo(
    () => scanTodos(draftBuffers.filter((f) => f.path.endsWith('.kin')).map((f) => ({ path: f.path, text: f.source }))),
    [draftBuffers],
  )
  /**
   * 预览用的作品主题 css（T077）：项目内全部 `.css` + 字体经 player 加载器编译成一段文本。
   * css 缓冲一变即重算 → 保存 / 编辑 css 时预览即时换肤。设置里关掉「应用作品主题」则为空串
   * （作者 css 越界污染编辑器 UI 时的逃生阀）。
   */
  const previewTheme = useMemo(() => {
    if (!state.projectDir) return { css: '', issues: [] as AssetIssue[] }
    const assets = discoverAssets(state.entries.map((e) => e.path))
    return buildProjectCss(assets, {
      readCss: (p) => state.files[p]?.source ?? null,
      resolveAsset: resolveRef.current,
    })
    // resolveRef 随项目切换更新（projectDir 一并变），故不必入依赖。
  }, [state.projectDir, state.entries, state.files])
  // 只有「是否注入」受开关控制；资源问题与开关无关，关掉主题也照样提示（否则作者查不出族名为何不生效）。
  const previewCss = settings.previewProjectTheme ? previewTheme.css : ''
  /** 资源问题（非法族名 / 同名冲突 / 读不到）汇成一行提示——播放端静默跳过，作者这里要看得见。 */
  const assetWarnings = useMemo(() => previewTheme.issues.map(describeAssetIssue), [previewTheme])
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
    // 只把 `.kin` 送进校验：缓冲里还有作品前端资源（css 等），它们不是 Kin 源码。
    const files = Object.values(filesRef.current)
      .filter((f) => f.path.endsWith('.kin'))
      .map((f) => ({ path: f.path, source: f.source }))
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
        // 口径须与「哪些文件有可编辑缓冲」一致（gateway 载入了文本的都算，含 css 等前端资源）——
        // 只取 .kin 会把资源草稿判成 missing 并在恢复时静默丢弃。
        const diskText = proj.files.filter((f) => f.source !== undefined).map((f) => ({ path: f.path, source: f.source ?? '' }))
        const items = detectRecoverable(store, dir, diskText)
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
    // 编辑窗就地换项目：脏缓冲或 AI 在跑 → 先确认（真正 loadDir 交给对话框解析器，先停 AI 后离），
    // 否则直接换。返回 true 表「已受理」（交给对话框也算，避免 onOpenRecent 误把有效项目当失败删掉）。
    if (anyDirty(state) || ai.running) {
      setPendingClose({ kind: 'switchProject', dir })
      return true
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
  // 读 committedStateRef（最新已提交态）而非闭包 state：解析器里 `await ai.stop()` 后 AI 收尾写
  // 已落进 reducer，闭包 state 却停在点击时的快照——读 ref 才能保存到 AI 停止后的最终内容。
  const saveAllDirty = async (): Promise<boolean> => {
    const cur = committedStateRef.current
    if (!cur.projectDir) return false
    try {
      const written: Record<string, string> = {}
      for (const f of Object.values(cur.files)) {
        if (f.dirty) { await gateway.writeFile(cur.projectDir, f.path, f.source); written[f.path] = f.source }
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
    // 作品主题随页内联：`file://` 下既不能 fetch 旁挂 css，Chrome 也按 opaque origin 拒载外链字体，
    // 故 css 文本内联、项目内字体 `url()` 重写为 data-URI；图片 / 音频保持相对路径（媒体加载不受限）。
    const assets = discoverAssets(state.entries.map((e) => e.path))
    const fontUris = new Map<string, string>()
    for (const f of assets.fonts) {
      try { fontUris.set(f, await gateway.readAssetDataUri(state.projectDir, f)) }
      catch { /* 读不到就跳过该字体：导出照常，缺的字体在页面上回退默认 */ }
    }
    const exportCss = buildProjectCss(assets, {
      readCss: (p) => state.files[p]?.source ?? null,
      resolveAsset: (p) => fontUris.get(p) ?? p,
    }).css
    const projectData = buildProjectData(state.manifest, Object.values(state.files), exportCss)
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
    // 关窗口用 destroy() 硬关、不给防抖 flush 机会，先显式落盘当前对话，防丢最后一轮（a6）。
    await ai.flush().catch(() => { /* 落盘失败不阻断退出 */ })
    if (settings.autosaveRecovery && state.projectDir) {
      try { await autosave.clearProjectDrafts(state.projectDir) } catch { /* 清草稿失败不阻断退出 */ }
    }
    try { await gateway.closeWindow() }
    catch (e) { setNotice(`退出失败：${errMsg(e)}`) }
  }
  // 退出守卫：有脏或 AI 在跑则弹确认框，否则直接退。
  const requestExit = () => {
    if (anyDirty(state) || ai.running) setPendingClose({ kind: 'exit' })
    else void doExit()
  }

  // 关闭当前项目回到启动页：清本项目残留草稿（同干净退出，避免下次误报崩溃恢复）。
  // - 编辑窗（'editor'）：开启动窗 → 关本编辑窗（互斥交接，不留空编辑窗）。
  // - web（null）：就地 dispatch project_closed 回启动页（单页 SPA）。
  const doCloseProject = async () => {
    // 编辑窗关项目也走 destroy() 硬关窗口；先显式落盘当前对话，防丢最后一轮（a6）。
    await ai.flush().catch(() => { /* 落盘失败不阻断关闭 */ })
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
  // 关闭项目守卫：有脏或 AI 在跑则弹确认框，否则直接关。
  const requestCloseProject = () => {
    if (anyDirty(state) || ai.running) setPendingClose({ kind: 'closeProject' })
    else void doCloseProject()
  }

  // 执行「离开当前项目」的实际动作（切换 / 关闭 / 退出）。tab 不走此处。
  const leaveProject = async (intent: CloseIntent) => {
    if (intent.kind === 'switchProject') {
      // 与 doExit/doCloseProject 一致：换项目前显式落盘当前对话，防丢最后一轮 AI 对话
      //（chat 持久化靠 1s 防抖，loadDir 改 projectDir 会取消未触发的防抖写）。此刻仍是旧项目，flush 写旧项目。
      await ai.flush().catch(() => { /* 落盘失败不阻断切换 */ })
      await loadDir(intent.dir)
    } else if (intent.kind === 'closeProject') await doCloseProject()
    else if (intent.kind === 'exit') await doExit()
  }
  // 对话框三解析器：消费 pendingClose 后置空。
  // 项目级动作的正确性核心：**先 await ai.stop()（等 AI 真正停下、in-flight dispatch 全落旧项目）
  // → 再保存 → 再离开**——保证 AI 的写入绝不跨到新项目。ai.stop() 未跑时是即时 resolve 的 no-op。
  const onCloseDialogSave = async () => {
    const intent = pendingClose
    setPendingClose(null)
    if (!intent) return
    if (intent.kind === 'tab') { if (await saveBuffer(intent.path)) dispatch({ type: 'close_tab', path: intent.path }); return }
    await ai.stop()
    if (!(await saveAllDirty())) return // 保存失败：停在当前项目，不离开
    await leaveProject(intent)
  }
  const onCloseDialogDiscard = async () => {
    const intent = pendingClose
    setPendingClose(null)
    if (!intent) return
    if (intent.kind === 'tab') { dispatch({ type: 'discard_tab', path: intent.path }); return }
    await ai.stop()
    await leaveProject(intent) // 丢弃：不保存直接离开
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
  useWindowLifecycle({
    gateway,
    windowMode,
    projectDir: state.projectDir,
    requestExitRef,
    enterProjectRef,
    loadDirRef,
    committedStateRef,
    setNotice,
  })

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
      const newEntry =
        state.manifest && state.manifestFile && state.entry
          ? entryAfterRename(state.entry, from, to)
          : null
      if (newEntry !== null && state.manifest && state.manifestFile) {
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
    if (state.entry && underPath(state.entry, path)) { setNotice('入口文件不可删除'); return }
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
        // 文本资源（css 等）导入后应即刻可编辑、且立即计入预览主题：回读一次文本。
        // 读失败不阻断导入（文件已落盘），退化成「只列名」，重开项目即恢复。
        const source = isTextFile(destRel)
          ? await gateway.readTextFile(state.projectDir, destRel).catch(() => undefined)
          : undefined
        if (isNew) {
          dispatch({ type: 'file_created', file: { path: destRel, isKin: false, source } })
          existing.add(destRel)
        } else if (source !== undefined) {
          // 覆盖式导入：磁盘已换新内容，缓冲若还留着旧文本，之后一次保存就会把导入的内容写没。
          dispatch({ type: 'buffer_reloaded', path: destRel, source })
        }
        imported++
      }
      if (imported > 0) setNotice(`已导入 ${imported} 个资源`, 'success')
    } catch (e) { setNotice(`导入失败：${errMsg(e)}`) }
  }
  const onAbout = () => setHelp('about')
  const onSyntaxRef = () => setHelp('syntax')
  const onThemeRef = () => setHelp('theme')
  const onReportIssue = () => setShowErrorDetails(true)
  const onOpenSettings = () => setSettingsOpen(true)
  const onSaveSettings = (next: Settings, nextTheme: ThemeState, nextAi: AiConfig) => {
    setSettings(clampSettings(next))
    setActiveThemeId(nextTheme.activeThemeId)
    setCustomThemes(nextTheme.customThemes)
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

  // 返回上一步（作者调试工具）：丢弃 seq 末元素、经既有保位重算落回上一决定点（无动画，直接定格）。
  // seq 空则 no-op。不改 seed（同一预览会话内后退确定性重建）；打断在飞的打字动画。
  const onBack = () => {
    const seq = interactionSeqRef.current
    if (seq.length === 0) return
    preview.cancel()
    recompute(programRef.current, seq.slice(0, -1), resolveRef.current, playRef.current)
  }

  const dirtyMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const f of Object.values(state.files)) m[f.path] = f.dirty
    return m
  }, [state.files])

  // 顶层渲染分流（模型 A）：
  // - 编辑窗启动、项目尚未载入完 → 过渡态占位（编辑窗永不停在「无项目」）。
  // - 启动窗，或 web/SPA 且无项目 → LaunchScreen。
  // - 其余（有项目，或编辑窗已载入）→ workbench。
  const editorBooting = windowMode === 'editor' && state.projectDir === null
  const showLaunch = windowMode === 'launch' || (windowMode === null && state.projectDir === null)

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
        activeThemeId={activeThemeId}
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
        onSetTheme={setPresetTheme}
        onToggleView={(key) => setView((v) => ({ ...v, [key]: !v[key] }))}
        onSyntaxRef={onSyntaxRef}
        onThemeRef={onThemeRef}
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
            <TodoPanel
              todos={todos}
              onJump={onJumpDiagnostic}
              collapsed={view.todoCollapsed}
              onToggleCollapse={() => setView((v) => ({ ...v, todoCollapsed: !v.todoCollapsed }))}
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
            <>
              {ai.running && (
                <div className="editor-readonly-banner" role="status">AI 正在修改，编辑区暂时只读</div>
              )}
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
                readOnly={ai.running}
              />
            </>
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
                  onBack={onBack} canGoBack={interactionSeqRef.current.length > 0}
                  reveal={preview.reveal} onContentClick={preview.onContentClick}
                  projectCss={previewCss} assetWarnings={assetWarnings} />
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
        activeThemeId={activeThemeId}
        customThemes={customThemes}
        aiConfig={aiConfig}
        controlInfo={controlInfo}
        onSave={onSaveSettings}
        onCancel={onCancelSettings}
        onExportTheme={(defaultName, contents) => gateway.exportThemeFile(defaultName, contents)}
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
        aiRunning={ai.running}
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
