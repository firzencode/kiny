import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export interface ViewPrefs {
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

export const DEFAULT_VIEW: ViewPrefs = {
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

export interface ViewPrefsApi {
  theme: Theme
  setTheme: React.Dispatch<React.SetStateAction<Theme>>
  view: ViewPrefs
  setView: React.Dispatch<React.SetStateAction<ViewPrefs>>
  hasSavedLayout: boolean
  onSaveLayout: () => void
  onRestoreMyLayout: () => void
  onRestoreDefaultLayout: () => void
  cols: React.CSSProperties
  explorerStyle: React.CSSProperties | undefined
  onResizeSidebar: (clientX: number) => void
  onResizeAi: (clientX: number) => void
  onResizeEditorPreview: (clientX: number) => void
  onResizeExplorer: (height: number) => void
}

/**
 * 主题 + 布局偏好（面板显隐 / 尺寸 / tab / 「我的布局」快照）的状态、持久化与拖拽换算。
 * 从 App.tsx 抽出——仅依赖 localStorage 与 workbench DOM 量测，不碰编辑器状态 / gateway / AI。
 * @param notifySaved 保存布局成功后的提示回调（App 接成 setNotice('已保存当前布局','success')）。
 */
export function useViewPrefs(notifySaved: () => void): ViewPrefsApi {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [view, setView] = useState<ViewPrefs>(loadView)
  const [savedView, setSavedView] = useState<ViewPrefs | null>(loadSavedView)
  const hasSavedLayout = savedView !== null

  // 主题 / 视图持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('kiny-editor-theme', theme) } catch { /* ignore */ }
  }, [theme])
  useEffect(() => {
    try { localStorage.setItem('kiny-editor-view', JSON.stringify(view)) } catch { /* ignore */ }
  }, [view])

  const onSaveLayout = () => {
    try { localStorage.setItem('kiny-editor-view-saved', JSON.stringify(view)) } catch { /* ignore */ }
    setSavedView(view)
    notifySaved()
  }
  // 恢复统一走 { ...DEFAULT_VIEW, ...target } 合并，保证将来 ViewPrefs 新增字段时旧快照缺的字段自动取默认。
  const onRestoreMyLayout = () => { if (savedView) setView({ ...DEFAULT_VIEW, ...savedView }) }
  const onRestoreDefaultLayout = () => setView({ ...DEFAULT_VIEW })

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

  return {
    theme, setTheme, view, setView, hasSavedLayout,
    onSaveLayout, onRestoreMyLayout, onRestoreDefaultLayout,
    cols, explorerStyle, onResizeSidebar, onResizeAi, onResizeEditorPreview, onResizeExplorer,
  }
}
