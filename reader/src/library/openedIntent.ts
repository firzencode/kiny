import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * 规整 RunEvent::Opened 的 url 载荷为字符串列表：丢非字符串、去首尾空白、丢空串、按出现序去重。
 * 载荷是 Rust 端 `tauri::Url` 序列化成的字符串数组（Android 上多为 `content://`）。
 */
export function normalizeOpenedUris(payload: unknown): string[] {
  if (!Array.isArray(payload)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of payload) {
    if (typeof u !== 'string') continue
    const s = u.trim()
    if (s.length === 0 || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * 冷启动：app 被「打开 / 分享 .kip」意图拉起时，Rust 在 UI 加载前已把 url 暂存进 state，
 * 这里一次性取回（桌面无此意图，返回空）。
 */
export async function getOpenedUris(): Promise<string[]> {
  return normalizeOpenedUris(await invoke('opened_urls'))
}

/**
 * 热启动：app 运行中收到新「打开 / 分享 .kip」意图时 Rust emit `"opened"`。
 * 桌面永不触发，此订阅无害。
 */
export function subscribeOpened(onUris: (uris: string[]) => void): Promise<UnlistenFn> {
  return listen('opened', (event) => {
    const uris = normalizeOpenedUris(event.payload)
    if (uris.length > 0) onUris(uris)
  })
}
