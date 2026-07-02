import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAiSession, cleanupExpiredChats, type UseAiSessionDeps } from './useAiSession'
import { initialEditorState, editorReducer, type EditorAction } from '../state/editorReducer'
import type { Provider } from './agentLoop'
import type { PreviewPort } from './actions'
import { createMemoryGateway } from '../files/memoryGateway'
import { projectKey, makeConversation, toChatStore, MS_PER_DAY, type ChatStore } from '../state/chatStore'
import type { FileGateway } from '../files/gateway'

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

// ---- T011e：对话历史持久化 / 多会话 ----

const okProvider = (content = 'ok'): Provider => ({
  chat: vi.fn().mockResolvedValue({ message: { role: 'assistant', content }, finishReason: 'stop' }),
})

function persistDeps(gateway: FileGateway, projectDir: string, provider: Provider): UseAiSessionDeps {
  return {
    ...makeDeps(provider),
    gateway: gateway as unknown as UseAiSessionDeps['gateway'],
    projectDir,
    persistDebounceMs: 5,
  }
}

describe('useAiSession 持久化 / 多会话', () => {
  it('一轮对话后防抖写回：文件含该会话的 turns + history', async () => {
    const gw = createMemoryGateway({ files: {} })
    const dir = '/proj'
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider('写好了'))))
    await act(async () => {})   // 先让载入 effect 落定（现实中项目载入总先于用户发话）
    act(() => result.current.send('帮我开个头'))
    await waitFor(() => expect(result.current.running).toBe(false))
    await waitFor(async () => {
      const store = await gw.readChatStore(projectKey(dir))
      expect(store?.conversations).toHaveLength(1)
    })
    const store = await gw.readChatStore(projectKey(dir))
    const conv = store!.conversations[0]
    expect(conv.title).toBe('帮我开个头')            // 首轮据 prompt 定标题
    expect(conv.turns).toHaveLength(1)
    expect(conv.turns[0].prompt).toBe('帮我开个头')
    // history 往返一致：user + assistant 都在（剔除 system）
    expect(conv.history.some((m) => m.role === 'user' && m.content === '帮我开个头')).toBe(true)
    expect(conv.history.some((m) => m.role === 'assistant')).toBe(true)
    expect(conv.history.some((m) => m.role === 'system')).toBe(false)
  })

  it('载入项目：还原会话列表并选中最近一条，turns/history 装回', async () => {
    const dir = '/proj'
    const older = { ...makeConversation('old', 100), title: '旧对话', lastActivityAt: 100,
      turns: [{ id: 1, prompt: 'a', segments: [], running: false }], history: [{ role: 'user' as const, content: 'a' }] }
    const newer = { ...makeConversation('new', 200), title: '新对话记录', lastActivityAt: 200,
      turns: [{ id: 2, prompt: 'b', segments: [], running: false }], history: [{ role: 'user' as const, content: 'b' }] }
    const store: ChatStore = toChatStore(dir, [older, newer])
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: store } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider())))
    await waitFor(() => expect(result.current.conversations).toHaveLength(2))
    expect(result.current.currentId).toBe('new')                       // 选最近
    expect(result.current.turns[0].prompt).toBe('b')                   // turns 装回
    expect(result.current.conversations.map((c) => c.id)).toEqual(['new', 'old'])  // 倒序
  })

  it('载入时把残留 running 轮重置为 false', async () => {
    const dir = '/proj'
    const conv = { ...makeConversation('c', 100), turns: [{ id: 1, prompt: 'a', segments: [], running: true }], history: [] }
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: toChatStore(dir, [conv]) } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider())))
    await waitFor(() => expect(result.current.turns).toHaveLength(1))
    expect(result.current.turns[0].running).toBe(false)
    expect(result.current.running).toBe(false)
  })

  it('selectConversation 切换 turns；newConversation 新建并切到空会话', async () => {
    const dir = '/proj'
    const a = { ...makeConversation('a', 100), turns: [{ id: 1, prompt: 'aa', segments: [], running: false }], history: [] }
    const b = { ...makeConversation('b', 200), turns: [{ id: 2, prompt: 'bb', segments: [], running: false }], history: [] }
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: toChatStore(dir, [a, b]) } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider())))
    await waitFor(() => expect(result.current.conversations).toHaveLength(2))
    act(() => result.current.selectConversation('a'))
    expect(result.current.turns[0].prompt).toBe('aa')
    act(() => result.current.newConversation())
    expect(result.current.turns).toHaveLength(0)
    expect(result.current.conversations).toHaveLength(3)
  })

  it('载入后继续该会话：新轮 id 不与已载入轮相撞（不污染旧轮）', async () => {
    const dir = '/proj'
    // 已持久化会话里已有 turn id=1（上次会话的小整数计数）
    const c = { ...makeConversation('c', 100), title: '旧对话',
      turns: [{ id: 1, prompt: '第一句', segments: [], running: false }],
      history: [{ role: 'user' as const, content: '第一句' }, { role: 'assistant' as const, content: '好的' }] }
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: toChatStore(dir, [c]) } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider('续上了'))))
    await waitFor(() => expect(result.current.turns).toHaveLength(1))
    act(() => result.current.send('第二句'))
    await waitFor(() => expect(result.current.running).toBe(false))
    // 两条 turn 都在、id 互异、旧轮内容未被污染
    expect(result.current.turns).toHaveLength(2)
    expect(result.current.turns[0].prompt).toBe('第一句')
    expect(result.current.turns[1].prompt).toBe('第二句')
    const ids = result.current.turns.map((t) => t.id)
    expect(new Set(ids).size).toBe(2)
    // 新轮拿到了回复片段，旧轮没有被追加
    expect(result.current.turns[0].segments).toHaveLength(0)
    expect(result.current.turns[1].segments.some((s) => s.kind === 'say')).toBe(true)
  })

  it('deleteConversation 删当前会话 → 切到剩余最近；写回文件', async () => {
    const dir = '/proj'
    const a = { ...makeConversation('a', 100), turns: [], history: [] }
    const b = { ...makeConversation('b', 200), turns: [], history: [] }
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: toChatStore(dir, [a, b]) } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider())))
    await waitFor(() => expect(result.current.currentId).toBe('b'))
    act(() => result.current.deleteConversation('b'))
    expect(result.current.currentId).toBe('a')
    await waitFor(async () => {
      const store = await gw.readChatStore(projectKey(dir))
      expect(store?.conversations.map((c) => c.id)).toEqual(['a'])
    })
  })

  it('删空全部会话 → 删文件（免孤儿空文件）', async () => {
    const dir = '/proj'
    const a = { ...makeConversation('a', 100), turns: [], history: [] }
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: toChatStore(dir, [a]) } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, okProvider())))
    await waitFor(() => expect(result.current.currentId).toBe('a'))
    act(() => result.current.deleteConversation('a'))
    await waitFor(async () => {
      expect(await gw.readChatStore(projectKey(dir))).toBeNull()
    })
  })

  it('运行中不切换 / 不删（守卫）', async () => {
    const dir = '/proj'
    // 永不 resolve 的 provider：使 running 保持 true
    const hang: Provider = { chat: vi.fn().mockReturnValue(new Promise(() => {})) }
    const a = { ...makeConversation('a', 100), turns: [], history: [] }
    const gw = createMemoryGateway({ files: {}, chatStores: { [projectKey(dir)]: toChatStore(dir, [a]) } })
    const { result } = renderHook(() => useAiSession(persistDeps(gw, dir, hang)))
    await waitFor(() => expect(result.current.currentId).toBe('a'))
    act(() => result.current.send('跑起来'))
    await waitFor(() => expect(result.current.running).toBe(true))
    act(() => result.current.selectConversation('a'))
    act(() => result.current.deleteConversation('a'))
    act(() => result.current.newConversation())
    // 仍在运行、会话仍在
    expect(result.current.running).toBe(true)
    expect(result.current.conversations.some((c) => c.id === 'a')).toBe(true)
  })
})

describe('cleanupExpiredChats', () => {
  const now = 1000 * MS_PER_DAY
  const fresh = { ...makeConversation('f', now - MS_PER_DAY), lastActivityAt: now - MS_PER_DAY }
  const stale = { ...makeConversation('s', now - 40 * MS_PER_DAY), lastActivityAt: now - 40 * MS_PER_DAY }

  it('剪掉过期会话；全过期则删文件；无过期不动', async () => {
    const gw = createMemoryGateway({
      files: {},
      chatStores: {
        mixed: toChatStore('/a', [fresh, stale]),
        allStale: toChatStore('/b', [stale]),
        allFresh: toChatStore('/c', [fresh]),
      },
    })
    await cleanupExpiredChats(gw, 30, now)
    expect((await gw.readChatStore('mixed'))!.conversations.map((c) => c.id)).toEqual(['f'])
    expect(await gw.readChatStore('allStale')).toBeNull()
    expect((await gw.readChatStore('allFresh'))!.conversations.map((c) => c.id)).toEqual(['f'])
  })

  it('retentionDays=null → 完全跳过', async () => {
    const gw = createMemoryGateway({ files: {}, chatStores: { k: toChatStore('/a', [stale]) } })
    await cleanupExpiredChats(gw, null, now)
    expect((await gw.readChatStore('k'))!.conversations).toHaveLength(1)
  })
})
