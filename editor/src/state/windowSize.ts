// 记忆用户手动调整过的 workbench 窗口尺寸（逻辑像素），下次进工作台复用。
// 关键守卫：最小化时 Tauri onResized 会报 0×0，绝不能把退化尺寸存进来 / 读回去——
// 否则下次 setWindowSize(0,0) 会把 .app（height:100%）内容区塌成 0，工作台整块不可见。

const WINDOW_KEY = 'kiny-editor-window'

// 合法窗口尺寸下限：镜像 editor/src-tauri/tauri.conf.json 的 minWidth/minHeight。
// 任何持久化的尺寸都至少等于窗口自身最小值；低于它（含最小化的 0）一律视为退化、丢弃。
export const WORKBENCH_MIN_SIZE = { width: 860, height: 560 }

// 启动窗（紧凑）/ 编辑窗（工作台）默认逻辑尺寸。创建独立 OS 窗口（openLaunchWindow /
// openEditorWindow）与非 Tauri SPA 尺寸翻转共用；编辑窗有记忆尺寸时优先用 loadWorkbenchSize()。
// LAUNCH_WINDOW 是取不到屏幕分辨率时的兜底；正常按 computeLaunchSize 依屏幕算。
export const LAUNCH_WINDOW = { width: 880, height: 620 }
export const WORKBENCH_WINDOW = { width: 1440, height: 900 }

// 启动窗尺寸夹取区间（逻辑像素）。下限贴合启动页布局（288px 动作列 + 最近列 + 边距）能容下的最小；
// 上限避免大屏上启动窗过分铺开。tauri.conf 启动窗 minWidth/minHeight 须 ≤ 此下限，否则 setSize 被夹住。
const LAUNCH_MIN = { width: 760, height: 560 }
const LAUNCH_MAX = { width: 1040, height: 800 }

/**
 * 按当前屏幕逻辑分辨率算启动窗固定尺寸：约屏宽一半、屏高六成，夹到 [LAUNCH_MIN, LAUNCH_MAX]。
 * 纯函数（无 IO），便于单测；取不到屏幕尺寸时调用方回落 LAUNCH_WINDOW。
 */
export function computeLaunchSize(monitor: { width: number; height: number }): { width: number; height: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  return {
    width: clamp(Math.round(monitor.width * 0.52), LAUNCH_MIN.width, LAUNCH_MAX.width),
    height: clamp(Math.round(monitor.height * 0.64), LAUNCH_MIN.height, LAUNCH_MAX.height),
  }
}

/** 尺寸是否合法可持久化：有限数且不低于窗口最小值（挡掉最小化 0×0 与其它退化值）。 */
export function isValidWorkbenchSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) && Number.isFinite(height) &&
    width >= WORKBENCH_MIN_SIZE.width && height >= WORKBENCH_MIN_SIZE.height
  )
}

/** 读记忆的 workbench 尺寸；无记录 / 解析失败 / 退化尺寸 → null（调用方回落默认）。 */
export function loadWorkbenchSize(): { width: number; height: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(WINDOW_KEY) || 'null')
    if (v && typeof v.width === 'number' && typeof v.height === 'number' && isValidWorkbenchSize(v.width, v.height)) {
      return { width: v.width, height: v.height }
    }
    return null
  } catch {
    return null
  }
}

/** 存 workbench 尺寸；退化尺寸（最小化 0×0 等）直接跳过，不污染记忆。 */
export function saveWorkbenchSize(width: number, height: number): void {
  if (!isValidWorkbenchSize(width, height)) return
  try { localStorage.setItem(WINDOW_KEY, JSON.stringify({ width, height })) } catch { /* ignore */ }
}
