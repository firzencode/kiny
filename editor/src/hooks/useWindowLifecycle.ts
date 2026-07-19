import { useEffect, useRef } from 'react'
import type { FileGateway, WindowMode } from '../files/gateway'
import type { EditorState } from '../state/editorReducer'
import { loadWorkbenchSize, saveWorkbenchSize, computeLaunchSize, LAUNCH_WINDOW, WORKBENCH_WINDOW } from '../state/windowSize'
import { parentDir } from '../util/paths'
import { errMsg } from '../util/errMsg'

export interface WindowLifecycleParams {
  gateway: FileGateway
  windowMode: WindowMode
  /** 当前项目目录（尺寸随「有↔无项目」翻转的依据）。 */
  projectDir: string | null
  /** OS 关窗请求 → 走退出守卫；ref 取最新闭包（避免一次性订阅 stale）。 */
  requestExitRef: React.MutableRefObject<() => void>
  /** 打开项目文件事件 / 冷启动路径 → 进项目；ref 间接层。 */
  enterProjectRef: React.MutableRefObject<(dir: string) => Promise<boolean>>
  /** 编辑窗从 ?project 载入项目；ref 间接层。 */
  loadDirRef: React.MutableRefObject<(dir: string) => Promise<boolean>>
  /** 最新已提交 state（窗口 resize 落库时读 projectDir）。 */
  committedStateRef: React.MutableRefObject<EditorState>
  setNotice: (msg: string | null, tone?: 'error' | 'success') => void
}

/**
 * Tauri 多窗模型 A 的窗口生命周期：关窗守卫、OS 打开 .kiw、尺寸随启动页↔workbench 翻转（web-SPA）、
 * 记忆 workbench 尺寸、冷启动取启动路径、启动窗按分辨率定尺寸、编辑窗从 ?project boot。
 * 全部从 App.tsx 抽出——依赖 loadDir / enterProject / requestExit 经 ref 间接层注入（打破与项目生命周期的循环）。
 */
export function useWindowLifecycle(p: WindowLifecycleParams): void {
  const { gateway, windowMode, projectDir, requestExitRef, enterProjectRef, loadDirRef, committedStateRef, setNotice } = p

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
  const prevProjectDirRef = useRef(projectDir)
  useEffect(() => {
    if (windowMode !== null) return // Tauri 多窗：尺寸随窗创建给定，不在窗内翻转
    const prev = prevProjectDirRef.current
    const cur = projectDir
    if (prev === cur) return
    prevProjectDirRef.current = cur
    // 只在「有项目 ↔ 无项目」边界翻转时调整；项目间切换（都非空）不动窗、不重复居中。
    // 进 workbench 优先用记忆的尺寸（用户上次手动调整的），未记过用默认；回启动页用固定尺寸。
    const size = prev === null && cur !== null ? (loadWorkbenchSize() ?? WORKBENCH_WINDOW) : prev !== null && cur === null ? LAUNCH_WINDOW : null
    if (size) void gateway.setWindowSize(size.width, size.height).catch((e) => console.error('调整窗口尺寸失败', e))
  }, [projectDir, gateway, windowMode])
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
}
