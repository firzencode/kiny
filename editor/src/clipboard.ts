import { readText } from '@tauri-apps/plugin-clipboard-manager'

/**
 * 经 Tauri clipboard 插件读取剪贴板纯文本。
 * 相较 webview 标准 `navigator.clipboard.readText()`，插件走原生路径、不弹权限申请框。
 */
export function readClipboardText(): Promise<string> {
  return readText()
}
