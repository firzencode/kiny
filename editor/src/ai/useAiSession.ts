/**
 * AI 对话/运行生命周期 hook（spec 2026-06-24-editor-ai-integration §3.3–3.4）。
 * 组 ActionContext（带活态镜像，让循环内 getState 看见同轮已派发改动）、驱动 runAgentLoop、
 * 管多会话 turns / running / 停止 / 历史持久化（T011e，spec 2026-07-01-editor-ai-chat-persistence）。
 *
 * 对话按项目分桶持久化到 app-data（经 gateway.readChatStore/writeChatStore）：
 * conversations 是单一真相，turns 从当前会话派生；每轮结束防抖写回当前项目文件。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runAgentLoop, type Provider, type ToolRunRecord, type AgentEvent } from './agentLoop'
import type { ActionContext, PreviewPort } from './actions'
import type { Message } from './provider'
import type { FileGateway } from '../files/gateway'
import { createTauriProvider } from './transport'
import { editorReducer, type EditorState, type EditorAction } from '../state/editorReducer'
import type { AiConfig } from './aiConfig'
import {
  type Conversation, type ChatStore,
  makeConversation, titleFromPrompt, projectKey, toChatStore, emptyChatStore,
  pruneExpired, sanitizeLoadedConversations, sortByRecent, mostRecentId,
  deleteConversation as removeConversation,
} from '../state/chatStore'

/** 一轮 AI 回应里的有序片段：思考 / 叙述 / 工具执行，按发生顺序交替呈现。 */
export type AiSegment =
  | { kind: 'think'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'tool'; record: ToolRunRecord }

export interface AiTurn { id: number; prompt: string; segments: AiSegment[]; error?: string; running: boolean }

/** 历史列表呈现用的会话摘要（不含 turns/history 大体量数据）。 */
export interface ConversationSummary { id: string; title: string; lastActivityAt: number }

export interface UseAiSessionDeps {
  committedStateRef: { current: EditorState }
  dispatch: (a: EditorAction) => void
  gateway: ActionContext['gateway']
  validator: ActionContext['validator']
  preview: PreviewPort
  config: AiConfig
  setNotice: (msg: string | null, tone?: 'error' | 'success') => void
  /** 当前项目根（对话按此分桶持久化）；null = 未打开项目，无可续历史。 */
  projectDir?: string | null
  /** 按日期清理阈值（载入时对当前项目顺带剪一次）；null = 关闭清理。 */
  retentionDays?: number | null
  makeProvider?: (c: AiConfig) => Provider
  /** 持久化防抖（测试可调小）。默认 1000ms。 */
  persistDebounceMs?: number
}

export interface AiSession {
  turns: AiTurn[]
  running: boolean
  send: (prompt: string) => void
  stop: () => void
  newConversation: () => void
  /** 该项目的会话列表（按 lastActivityAt 倒序，供历史面板呈现）。 */
  conversations: ConversationSummary[]
  /** 当前选中会话 id；null = 无会话（空项目 / 全删）。 */
  currentId: string | null
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
}

/** 跨会话唯一 id：优先 crypto.randomUUID，回退时间戳+随机（仅本地存储用，无需强唯一）。 */
function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function useAiSession(deps: UseAiSessionDeps): AiSession {
  const { committedStateRef, dispatch, gateway, validator, preview, config, setNotice } = deps
  const projectDir = deps.projectDir ?? null
  const persistDebounceMs = deps.persistDebounceMs ?? 1000

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const mirrorRef = useRef<EditorState | null>(null)   // 运行中的活态镜像；null = 读已提交
  const abortRef = useRef<AbortController | null>(null)
  const idRef = useRef(0)
  const runningRef = useRef(false)             // 同步守卫：避免 running state 的 stale closure
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations
  const currentIdRef = useRef(currentId); currentIdRef.current = currentId
  const retentionRef = useRef(deps.retentionDays ?? null); retentionRef.current = deps.retentionDays ?? null
  // gateway 现实中是稳定单例；用 ref 读，避免测试里每渲染新建 deps 令 effect 依赖抖动成死循环。
  const gatewayRef = useRef(gateway); gatewayRef.current = gateway
  // 「已为此 projectDir 载入完成」标记：防项目切换瞬间用旧 conversations 误写到新项目文件。
  const loadedDirRef = useRef<string | null>(null)

  // 当前会话的 turns（派生自单一真相 conversations）。
  const turns = useMemo(
    () => conversations.find((c) => c.id === currentId)?.turns ?? [],
    [conversations, currentId],
  )

  // 稳定 ctx：getState 运行中读镜像、空闲读已提交；dispatch 双写（React + 镜像）。
  const ctx: ActionContext = useMemo(() => ({
    getState: () => mirrorRef.current ?? committedStateRef.current,
    dispatch: (a: EditorAction) => {
      const base = mirrorRef.current ?? committedStateRef.current
      mirrorRef.current = editorReducer(base, a)
      dispatch(a)
    },
    gateway,
    validator,
    preview,
  }), [committedStateRef, dispatch, gateway, validator, preview])

  // 载入：项目切换时读该项目对话文件 → 按日期剪 → 选最近会话。降级到空列表不报错。
  useEffect(() => {
    let cancelled = false
    if (!projectDir) {
      loadedDirRef.current = null
      // 无项目：清空（已空则跳过，免无谓再渲染）。
      if (conversationsRef.current.length > 0 || currentIdRef.current !== null) {
        setConversations([]); setCurrentId(null)
      }
      return
    }
    void (async () => {
      const store = await gatewayRef.current.readChatStore(projectKey(projectDir))
      if (cancelled) return
      const base: ChatStore = store ?? emptyChatStore(projectDir)
      const pruned = pruneExpired(base, retentionRef.current, Date.now())
      const convs = sanitizeLoadedConversations(pruned.conversations)
      // 播种 turn id 计数器到已载入的最大值：否则继续一条已持久化会话时新轮 id 会与旧轮撞
      // （每挂载从 0 起），令片段错挂旧轮、React key 重复。
      const maxTurnId = convs.reduce((m, c) => c.turns.reduce((mm, t) => Math.max(mm, t.id), m), 0)
      idRef.current = Math.max(idRef.current, maxTurnId)
      setConversations(convs)
      setCurrentId(mostRecentId(convs))
      loadedDirRef.current = projectDir
    })()
    return () => { cancelled = true }
  }, [projectDir])

  // 持久化：会话变动且非运行中时防抖写回当前项目文件（空则删文件免孤儿）。
  useEffect(() => {
    if (!projectDir || loadedDirRef.current !== projectDir || running) return
    const h = setTimeout(() => {
      const key = projectKey(projectDir)
      const convs = conversationsRef.current
      if (convs.length === 0) void gatewayRef.current.deleteChatStore(key)
      else void gatewayRef.current.writeChatStore(key, toChatStore(projectDir, convs))
    }, persistDebounceMs)
    return () => clearTimeout(h)
  }, [projectDir, conversations, running, persistDebounceMs])

  const send = useCallback((prompt: string) => {
    if (runningRef.current || prompt.trim() === '') return
    const now = Date.now()

    // 确保有当前会话；无则新建并切入（首发时 seedHistory 天然为空）。
    let convId = currentIdRef.current
    let seedHistory: Message[] = []
    if (convId == null) {
      const conv = makeConversation(newId(), now)
      convId = conv.id
      setConversations((prev) => [...prev, conv])
      setCurrentId(conv.id); currentIdRef.current = conv.id
    } else {
      seedHistory = conversationsRef.current.find((c) => c.id === convId)?.history ?? []
    }
    const cid = convId

    const turnId = ++idRef.current
    // 追加用户轮；首轮顺带据 prompt 定标题。
    setConversations((prev) => prev.map((c) => (c.id === cid ? {
      ...c,
      title: c.turns.length === 0 ? titleFromPrompt(prompt) : c.title,
      turns: [...c.turns, { id: turnId, prompt, segments: [], running: true }],
      lastActivityAt: now,
    } : c)))

    setRunning(true)
    runningRef.current = true

    const ac = new AbortController()
    abortRef.current = ac
    mirrorRef.current = committedStateRef.current   // seed 镜像

    const provider = (deps.makeProvider ?? createTauriProvider)(config)
    // 进度回调：每段思考 / 叙述 / 工具执行完即按序追加进当前这轮，UI 边跑边显。
    const onEvent = (e: AgentEvent) => {
      const seg: AiSegment =
        e.type === 'tool' ? { kind: 'tool', record: e.record }
          : e.type === 'thinking' ? { kind: 'think', text: e.content }
            : { kind: 'say', text: e.content }
      setConversations((prev) => prev.map((c) => (c.id === cid ? {
        ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, segments: [...t.segments, seg] } : t)),
      } : c)))
    }
    runAgentLoop(prompt, { provider, ctx, model: config.model, signal: ac.signal, onEvent }, seedHistory)
      .then((res) => {
        const hist = res.messages.filter((m) => m.role !== 'system')
        setConversations((prev) => prev.map((c) => (c.id === cid ? {
          ...c, history: hist, lastActivityAt: Date.now(),
          turns: c.turns.map((t) => (t.id === turnId ? { ...t, running: false } : t)),
        } : c)))
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setNotice(msg, 'error')
        setConversations((prev) => prev.map((c) => (c.id === cid ? {
          ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, error: msg, running: false } : t)),
        } : c)))
      })
      .finally(() => {
        mirrorRef.current = null
        abortRef.current = null
        setRunning(false)
        runningRef.current = false
      })
  }, [ctx, config, committedStateRef, setNotice, deps.makeProvider])

  const stop = useCallback(() => { abortRef.current?.abort() }, [])

  const newConversation = useCallback(() => {
    if (runningRef.current) return
    // 已在一条空会话上则不再新建（避免堆积多条空「新对话」）。
    const cur = conversationsRef.current.find((c) => c.id === currentIdRef.current)
    if (cur && cur.turns.length === 0) return
    const conv = makeConversation(newId(), Date.now())
    setConversations((prev) => [...prev, conv])
    setCurrentId(conv.id); currentIdRef.current = conv.id
  }, [])

  const selectConversation = useCallback((id: string) => {
    if (runningRef.current) return
    setCurrentId(id); currentIdRef.current = id
  }, [])

  const deleteConversation = useCallback((id: string) => {
    if (runningRef.current) return
    const next = removeConversation(conversationsRef.current, id)
    setConversations(next); conversationsRef.current = next
    if (currentIdRef.current === id) {
      const nextId = mostRecentId(next)
      setCurrentId(nextId); currentIdRef.current = nextId
    }
  }, [])

  const summaries = useMemo<ConversationSummary[]>(
    () => sortByRecent(conversations).map((c) => ({ id: c.id, title: c.title, lastActivityAt: c.lastActivityAt })),
    [conversations],
  )

  return { turns, running, send, stop, newConversation, conversations: summaries, currentId, selectConversation, deleteConversation }
}

/**
 * 启动期按日期清理全部项目的对话文件（spec §5）：枚举 ai-chats/ 逐文件剪过期会话，
 * 空则删文件。retentionDays === null → 跳过。失败静默（背景维护，不阻断启动）。
 */
export async function cleanupExpiredChats(
  gateway: Pick<FileGateway, 'listChatStoreKeys' | 'readChatStore' | 'writeChatStore' | 'deleteChatStore'>,
  retentionDays: number | null,
  now: number,
): Promise<void> {
  if (retentionDays === null) return
  const keys = await gateway.listChatStoreKeys()
  for (const key of keys) {
    const store = await gateway.readChatStore(key)
    if (!store) continue
    const pruned = pruneExpired(store, retentionDays, now)
    if (pruned.conversations.length === 0) await gateway.deleteChatStore(key)
    else if (pruned.conversations.length !== store.conversations.length) await gateway.writeChatStore(key, pruned)
  }
}
