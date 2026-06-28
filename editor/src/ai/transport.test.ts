import { describe, it, expect, vi } from 'vitest'
import { createTauriProvider, completionsUrl, type FetchLike } from './transport'
import type { AiConfig } from './aiConfig'

const cfg: AiConfig = { provider: 'openai-compatible', endpoint: 'https://api.x/v1/chat/completions', model: 'm', apiKey: 'sk-secret' }

const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('createTauriProvider', () => {
  it('POST 到所配 endpoint，带 Bearer key 与 JSON body', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      okResponse({ choices: [{ message: { content: '好的' }, finish_reason: 'stop' }] }))
    const provider = createTauriProvider(cfg, fetchImpl)
    const resp = await provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(cfg.endpoint)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string).model).toBe('m')
    expect(resp.message.content).toBe('好的')
    expect(resp.finishReason).toBe('stop')
  })

  it('非 2xx 抛带状态码的 Error（不静默）', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response('{"error":{"message":"bad key"}}', { status: 401, statusText: 'Unauthorized' }))
    const provider = createTauriProvider(cfg, fetchImpl)
    await expect(provider.chat({ model: 'm', messages: [] })).rejects.toThrow(/401/)
  })

  it('透传 AbortSignal 给 fetch', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      okResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }))
    const provider = createTauriProvider(cfg, fetchImpl)
    const ac = new AbortController()
    await provider.chat({ model: 'm', messages: [] }, ac.signal)
    expect(fetchImpl.mock.calls[0][1].signal).toBe(ac.signal)
  })

  it('填 Base URL 时自动补 /chat/completions', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      okResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }))
    const base: AiConfig = { ...cfg, endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4' }
    await createTauriProvider(base, fetchImpl).chat({ model: 'm', messages: [] })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions')
  })
})

describe('completionsUrl', () => {
  it('base URL 补 /chat/completions', () => {
    expect(completionsUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions')
  })
  it('已含 /chat/completions 的完整地址原样用', () => {
    expect(completionsUrl('https://api.x/v1/chat/completions')).toBe('https://api.x/v1/chat/completions')
  })
  it('去掉末尾多余斜杠再拼', () => {
    expect(completionsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions')
  })
})
