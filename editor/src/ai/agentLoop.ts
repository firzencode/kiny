import { runCommand, type ActionContext, type ActionCommand } from './actions'
import type { ChatRequest, Message, ToolCall, ToolDefinition } from './provider'
import { TOOL_DEFINITIONS } from './toolDefinitions'
import { KIN_KNOWLEDGE } from './kinKnowledge'

/**
 * 内置 AI agent 循环（spec 2026-06-24-editor-ai-integration §3.3）。
 *
 * 组请求（系统提示=精简 Kin 语言知识 + 当前项目上下文 + 动作层 tool-definitions）+ 对话历史
 * → 调注入的 {@link Provider} → 拿 toolCalls 经动作层 {@link runCommand} 逐个执行
 * → 结果作 tool-result 回喂 → 迭代到无 tool call → 输出最终回复。全程可经 AbortSignal 停止。
 *
 * Provider 由 T011d 用 adapter + Tauri HTTP 直连实现并注入；测试注入假 provider。
 */

/** 注入的 provider：把一次 IR 请求变成一次 IR 响应。 */
export interface Provider {
  chat(req: ChatRequest, signal?: AbortSignal): Promise<import('./provider').ChatResponse>
}

export interface AgentLoopOptions {
  provider: Provider
  /** 动作层上下文（命令经它落到 editor 状态 / gateway）。 */
  ctx: ActionContext
  model: string
  /** 精简 Kin 语言知识（默认 {@link KIN_KNOWLEDGE}）。 */
  kinKnowledge?: string
  /** 动作层 tool-definitions（默认全部命令）。 */
  tools?: ToolDefinition[]
  /** 停止信号：aborted 时循环在安全点退出。 */
  signal?: AbortSignal
  /** 迭代轮数兜底（防失控），默认 25。 */
  maxRounds?: number
  temperature?: number
  /** 进度回调：每段中间叙述 / 每个工具执行完即回调，供 UI 实时呈现。 */
  onEvent?: (event: AgentEvent) => void
}

/** 一次工具调用的执行记录。 */
export interface ToolRunRecord {
  call: ToolCall
  result: string
  ok: boolean
}

/**
 * 循环进度事件（让 UI 边跑边显中间态，而非整轮结束才一次性出）。
 * `assistant`=某轮 LLM 的（中间）叙述文本；`tool`=刚执行完一个工具。
 */
export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'tool'; record: ToolRunRecord }

export interface AgentRunResult {
  /** 最终助手回复（无 tool call 的那条）。被 abort / 触顶时为最后一条助手内容。 */
  reply: string
  /** 完整对话消息（含 system / user / assistant / tool）。 */
  messages: Message[]
  /** 各次工具执行记录。 */
  toolRuns: ToolRunRecord[]
  /** 实际迭代轮数（provider 调用次数）。 */
  rounds: number
  /** 是否因 abort 提前停止。 */
  stopped: boolean
}

/** 组系统提示：精简 Kin 语言知识 + 当前项目上下文。 */
export function buildSystemPrompt(ctx: ActionContext, kinKnowledge: string = KIN_KNOWLEDGE): string {
  const s = ctx.getState()
  const lines: string[] = []
  if (s.projectDir) {
    lines.push(`项目根：${s.projectDir}`)
    if (s.manifest) lines.push(`入口文件：${s.manifest.entry}`)
    const files = s.entries.map((e) => e.path)
    lines.push(files.length > 0 ? `文件清单：\n${files.map((p) => `  - ${p}`).join('\n')}` : '文件清单：（空）')
    if (s.activeFile) lines.push(`当前活动文件：${s.activeFile}`)
  } else {
    lines.push('（当前未打开任何项目。）')
  }
  return `${kinKnowledge}\n\n# 当前项目上下文\n${lines.join('\n')}`
}

/** 把一次 toolCall 映射成动作层命令并执行，结果序列化为 tool-result 文本；失败则回错误文本。 */
async function executeTool(ctx: ActionContext, call: ToolCall): Promise<ToolRunRecord> {
  try {
    const cmd = { name: call.name, ...call.arguments } as unknown as ActionCommand
    const out = await runCommand(ctx, cmd)
    return { call, result: JSON.stringify(out ?? null), ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { call, result: JSON.stringify({ error: message }), ok: false }
  }
}

/**
 * 跑一轮（或多轮）agent 循环。`prompt` 是本次用户输入，`history` 是先前对话（不含 system）。
 */
export async function runAgentLoop(
  prompt: string,
  opts: AgentLoopOptions,
  history: Message[] = [],
): Promise<AgentRunResult> {
  const { provider, ctx, model, signal } = opts
  const tools = opts.tools ?? TOOL_DEFINITIONS
  const maxRounds = opts.maxRounds ?? 25

  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(ctx, opts.kinKnowledge) },
    ...history,
    { role: 'user', content: prompt },
  ]
  const toolRuns: ToolRunRecord[] = []
  let rounds = 0
  let lastContent = ''

  while (true) {
    if (signal?.aborted) return { reply: lastContent, messages, toolRuns, rounds, stopped: true }

    rounds++
    const req: ChatRequest = { model, messages, tools }
    if (opts.temperature !== undefined) req.temperature = opts.temperature

    let resp: import('./provider').ChatResponse
    try {
      resp = await provider.chat(req, signal)
    } catch (e) {
      // 传输层在 abort 时通常 reject（AbortError）——归一成 stopped，不外抛。
      if (signal?.aborted) return { reply: lastContent, messages, toolRuns, rounds, stopped: true }
      throw e
    }

    const calls = resp.message.toolCalls ?? []

    if (signal?.aborted) {
      // 中途停止：带未执行 toolCalls 的助手消息会让 messages 悬空
      // （assistant(tool_calls) 后必须紧跟对应 tool 结果，否则续话请求被 provider 拒）——丢弃它。
      // 纯文本（无 toolCalls）的最终消息则保留，便于呈现/续话。
      if (calls.length === 0) {
        messages.push(resp.message)
        lastContent = resp.message.content
      }
      return { reply: lastContent, messages, toolRuns, rounds, stopped: true }
    }

    messages.push(resp.message)
    lastContent = resp.message.content
    if (resp.message.reasoning) opts.onEvent?.({ type: 'thinking', content: resp.message.reasoning })
    if (resp.message.content) opts.onEvent?.({ type: 'assistant', content: resp.message.content })

    if (calls.length === 0) {
      return { reply: resp.message.content, messages, toolRuns, rounds, stopped: false }
    }

    for (const call of calls) {
      const record = await executeTool(ctx, call)
      toolRuns.push(record)
      opts.onEvent?.({ type: 'tool', record })
      messages.push({ role: 'tool', toolCallId: call.id, content: record.result })
    }

    if (rounds >= maxRounds) {
      return { reply: lastContent, messages, toolRuns, rounds, stopped: false }
    }
  }
}
