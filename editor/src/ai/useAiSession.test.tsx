import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAiSession, type UseAiSessionDeps } from './useAiSession'
import { initialEditorState, editorReducer, type EditorAction } from '../state/editorReducer'
import type { Provider } from './agentLoop'
import type { PreviewPort } from './actions'

const fakePreview: PreviewPort = {
  snapshot: () => ({ play: null, stale: false, choiceSeq: [] }),
  choose: () => ({ play: null, stale: false, choiceSeq: [] }),
  restart: () => ({ play: null, stale: false, choiceSeq: [] }),
}

function makeDeps(provider: Provider): UseAiSessionDeps {
  return {
    committedStateRef: { current: initialEditorState },
    dispatch: vi.fn(),
    gateway: {} as never,
    validator: { validate: () => ({ ok: true, diagnostics: [], program: null } as never) },
    preview: fakePreview,
    config: { provider: 'openai-compatible', endpoint: 'https://x', model: 'm', apiKey: 'k' },
    setNotice: vi.fn(),
    makeProvider: () => provider,
  }
}

describe('useAiSession', () => {
  it('send 一轮：无 tool call 直接出回复，记一条 turn', async () => {
    const provider: Provider = {
      chat: vi.fn().mockResolvedValue({ message: { role: 'assistant', content: '你好，我能帮你写故事。' }, finishReason: 'stop' }),
    }
    const { result } = renderHook(() => useAiSession(makeDeps(provider)))
    act(() => result.current.send('帮我开个头'))
    await waitFor(() => expect(result.current.running).toBe(false))
    expect(result.current.turns).toHaveLength(1)
    expect(result.current.turns[0].prompt).toBe('帮我开个头')
    const say = result.current.turns[0].segments.find((s) => s.kind === 'say')
    expect(say && 'text' in say && say.text).toContain('写故事')
  })

  it('思考型模型：reasoning 作 think 片段先于回复呈现', async () => {
    const provider: Provider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '这就开始。', reasoning: '先想想结构……' },
        finishReason: 'stop',
      }),
    }
    const { result } = renderHook(() => useAiSession(makeDeps(provider)))
    act(() => result.current.send('开头'))
    await waitFor(() => expect(result.current.running).toBe(false))
    const kinds = result.current.turns[0].segments.map((s) => s.kind)
    expect(kinds).toEqual(['think', 'say'])
    const think = result.current.turns[0].segments[0]
    expect(think.kind === 'think' && think.text).toBe('先想想结构……')
  })

  it('provider 抛错：turn 记 error 且调 setNotice', async () => {
    const provider: Provider = { chat: vi.fn().mockRejectedValue(new Error('请求失败：401 Unauthorized')) }
    const deps = makeDeps(provider)
    const { result } = renderHook(() => useAiSession(deps))
    act(() => result.current.send('续写'))
    await waitFor(() => expect(result.current.running).toBe(false))
    expect(result.current.turns[0].error).toMatch(/401/)
    expect(deps.setNotice).toHaveBeenCalledWith(expect.stringMatching(/401/), 'error')
  })

  it('newConversation 清空 turns', async () => {
    const provider: Provider = { chat: vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' }) }
    const { result } = renderHook(() => useAiSession(makeDeps(provider)))
    act(() => result.current.send('a'))
    await waitFor(() => expect(result.current.running).toBe(false))
    act(() => result.current.newConversation())
    expect(result.current.turns).toHaveLength(0)
  })

  it('tool call：ctx.dispatch 被调用且 toolRuns 有记录（活态镜像执行路径不被静默丢弃）', async () => {
    const committedStateRef = { current: initialEditorState }
    const dispatch = vi.fn((action: EditorAction) => {
      committedStateRef.current = editorReducer(committedStateRef.current, action)
    })
    const provider: Provider = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'validate', arguments: {} }] },
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: '校验完成，无错误。' },
          finishReason: 'stop',
        }),
    }
    const deps: UseAiSessionDeps = {
      committedStateRef,
      dispatch,
      gateway: {} as never,
      validator: { validate: () => ({ ok: true, diagnostics: [], program: null } as never) },
      preview: fakePreview,
      config: { provider: 'openai-compatible', endpoint: 'https://x', model: 'm', apiKey: 'k' },
      setNotice: vi.fn(),
      makeProvider: () => provider,
    }
    const { result } = renderHook(() => useAiSession(deps))
    act(() => result.current.send('帮我校验项目'))
    await waitFor(() => expect(result.current.running).toBe(false))
    // (a) ctx.dispatch 被调到（validate 工具经活态镜像写回 editor）
    expect(dispatch).toHaveBeenCalled()
    // (b) tool 片段有记录：validate 工具被执行、未被静默丢弃
    const tools = result.current.turns[0].segments.filter((s) => s.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0].kind === 'tool' && tools[0].record.call.name).toBe('validate')
  })
})
