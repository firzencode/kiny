/**
 * 屏蔽 webview 默认右键菜单（刷新 / 重新加载 / 检查元素等浏览器菜单）。
 * 应用内的自定义右键菜单各自在 React 的 onContextMenu 里设状态弹出，不受影响。
 */
export function installContextMenuGuard(target: EventTarget = window): void {
  target.addEventListener('contextmenu', (e) => e.preventDefault())
}
