/**
 * AI 对话/运行生命周期 hook（spec 2026-06-24-editor-ai-integration §3.3–3.4）。
 * 组 ActionContext（带活态镜像，让循环内 getState 看见同轮已派发改动）、驱动 runAgentLoop、
 * 管 turns / running / 停止。对话历史本期内存态（持久化 = BACKLOG T011e）。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { runAgentLoop, type Provider, type ToolRunRecord, type AgentEvent } from './agentLoop'
import type { ActionContext, PreviewPort } from './actions'
import type { Message } from './provider'
import { createTauriProvider } from './transport'
import { editorReducer, type EditorState, type EditorAction } from '../state/editorReducer'
import type { AiConfig } from './aiConfig'

/** 一轮 AI 回应里的有序片段：思考 / 叙述 / 工具执行，按发生顺序交替呈现。 */
export type AiSegment =
  | { kind: 'think'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'tool'; record: ToolRunRecord }

export interface AiTurn { id: number; prompt: string; segments: AiSegment[]; error?: string; running: boolean }

export interface UseAiSessionDeps {
  committedStateRef: { current: EditorState }
  dispatch: (a: EditorAction) => void
  gateway: ActionContext['gateway']
  validator: ActionContext['validator']
  preview: PreviewPort
  config: AiConfig
  setNotice: (msg: string | null, tone?: 'error' | 'success') => void
  makeProvider?: (c: AiConfig) => Provider
}

export interface AiSession {
  turns: AiTurn[]
  running: boolean
  send: (prompt: string) => void
  stop: () => void
  newConversation: () => void
}

export function useAiSession(deps: UseAiSessionDeps): AiSession {
  const { committedStateRef, dispatch, gateway, validator, preview, config, setNotice } = deps
  const [turns, setTurns] = useState<AiTurn[]>([])
  const [running, setRunning] = useState(false)

  const historyRef = useRef<Message[]>([])     // 喂 runAgentLoop 的累积对话（不含 system）
  const mirrorRef = useRef<EditorState | null>(null)   // 运行中的活态镜像；null = 读已提交
  const abortRef = useRef<AbortController | null>(null)
  const idRef = useRef(0)
  const runningRef = useRef(false)             // 同步守卫：避免 running state 的 stale closure

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

  const send = useCallback((prompt: string) => {
    if (runningRef.current || prompt.trim() === '') return
    const id = ++idRef.current
    setTurns((t) => [...t, { id, prompt, segments: [], running: true }])
    setRunning(true)
    runningRef.current = true

    const ac = new AbortController()
    abortRef.current = ac
    mirrorRef.current = committedStateRef.current   // seed 镜像

    const provider = (deps.makeProvider ?? createTauriProvider)(config)
    // 进度回调：每段思考 / 叙述 / 工具执行完即按序追加进当前这轮，UI 边跑边显（不再整轮结束才出）。
    const onEvent = (e: AgentEvent) => {
      const seg: AiSegment =
        e.type === 'tool' ? { kind: 'tool', record: e.record }
          : e.type === 'thinking' ? { kind: 'think', text: e.content }
            : { kind: 'say', text: e.content }
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, segments: [...x.segments, seg] } : x)))
    }
    runAgentLoop(prompt, { provider, ctx, model: config.model, signal: ac.signal, onEvent }, historyRef.current)
      .then((res) => {
        historyRef.current = res.messages.filter((m) => m.role !== 'system')
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, running: false } : x)))
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setNotice(msg, 'error')
        setTurns((t) => t.map((x) => x.id === id ? { ...x, error: msg, running: false } : x))
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
    if (running) return
    historyRef.current = []
    setTurns([])
  }, [running])

  return { turns, running, send, stop, newConversation }
}
