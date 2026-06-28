/**
 * 直连传输（spec 2026-06-24-editor-ai-integration §3.3 步骤3 + §4）。
 * 包 openAiCompatibleAdapter，经 Tauri plugin-http 直连用户所配 endpoint——
 * key 与请求只在本机、不中转（守不托管）。fetchImpl 可注入便于测试。
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { openAiCompatibleAdapter, type ChatRequest, type ChatResponse } from './provider'
import type { Provider } from './agentLoop'
import type { AiConfig } from './aiConfig'

export type FetchLike = (input: string, init: RequestInit & { signal?: AbortSignal }) => Promise<Response>

const truncate = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s)

/**
 * 把用户填的 **Base URL** 归一成 chat completions 请求地址。
 * 主路径：填 base（如 `https://open.bigmodel.cn/api/coding/paas/v4`），自动补 `/chat/completions`。
 * 容错：若已含 `/chat/completions`（用户直接贴了完整地址），原样用，不重复拼。末尾多余斜杠去掉。
 */
export function completionsUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

export function createTauriProvider(config: AiConfig, fetchImpl: FetchLike = tauriFetch as unknown as FetchLike): Provider {
  return {
    async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
      const body = openAiCompatibleAdapter.encodeRequest(req)
      const resp = await fetchImpl(completionsUrl(config.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal,
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`请求失败：${resp.status} ${resp.statusText}${text ? ` — ${truncate(text)}` : ''}`)
      }
      const raw: unknown = await resp.json()
      return openAiCompatibleAdapter.decodeResponse(raw)
    },
  }
}
