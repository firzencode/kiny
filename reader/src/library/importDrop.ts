import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'

/** 订阅窗口拖放，过滤出 .kip 路径回调。Android 无拖放，此订阅不触发（无害）。 */
export function subscribeKipDrop(onKips: (paths: string[]) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      const kips = event.payload.paths.filter((p) => p.toLowerCase().endsWith('.kip'))
      if (kips.length > 0) onKips(kips)
    }
  })
}
