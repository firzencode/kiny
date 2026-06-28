/**
 * Provider 适配层（spec 2026-06-24-editor-ai-integration §3.1–3.2）。
 *
 * 定义内置 agent 循环（T011c）与各 LLM provider 之间的统一**中间表示（IR）**，
 * 并实现 `openai-compatible` adapter——把 IR 双向映射到 OpenAI Chat Completions
 * 请求 / 响应（含 tool call 往返）。loop 只跟 IR 打交道，provider 差异收在 adapter 里。
 *
 * 本层是**纯数据映射**：不发 HTTP（传输由 T011d 经 Tauri 直连所配 endpoint 注入）。
 * IR 边界即为日后加别的 provider（如 anthropic）预留的接口——本期只做 openai-compatible。
 */

// ---- 统一中间表示（IR）----

/** 系统提示消息。 */
export interface SystemMessage {
  role: 'system'
  content: string
}

/** 用户消息。 */
export interface UserMessage {
  role: 'user'
  content: string
}

/** 一次工具调用：name = 动作层命令名，arguments = 该命令的类型化参数对象。 */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** 助手消息：可携带零或多个工具调用，及（思考型模型的）推理文本。 */
export interface AssistantMessage {
  role: 'assistant'
  content: string
  toolCalls?: ToolCall[]
  /** 思考型模型（DeepSeek-R1 / GLM 等）的推理过程，取自响应 reasoning_content；仅供 UI 呈现，不回喂。 */
  reasoning?: string
}

/** 工具结果消息：回喂某次工具调用的执行结果（content 为序列化后的结果文本）。 */
export interface ToolResultMessage {
  role: 'tool'
  toolCallId: string
  content: string
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage

/** 工具定义：由动作层命令映射而来（T011c 负责生成），喂给 LLM 作 tool。 */
export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema（描述命令参数）。 */
  parameters: Record<string, unknown>
}

/** loop → adapter 的请求（IR）。 */
export interface ChatRequest {
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  temperature?: number
}

/** adapter → loop 的响应（IR）。 */
export interface ChatResponse {
  message: AssistantMessage
  finishReason: string
}

/**
 * Provider 适配器：IR ↔ 某 provider 线格式的双向映射。
 * `encodeRequest` 出请求体（交给传输层 POST），`decodeResponse` 解原始响应回 IR。
 */
export interface ProviderAdapter {
  encodeRequest(req: ChatRequest): unknown
  decodeResponse(raw: unknown): ChatResponse
}

// ---- openai-compatible adapter ----

interface OAToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OAMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: OAToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

function encodeMessage(msg: Message): OAMessage {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content }
    case 'user':
      return { role: 'user', content: msg.content }
    case 'assistant': {
      const out: OAMessage = { role: 'assistant', content: msg.content }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
      }
      return out
    }
    case 'tool':
      return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content }
  }
}

/**
 * openai-compatible adapter：覆盖 OpenAI / DeepSeek / GLM 等兼容 OpenAI Chat Completions + tools 的供应商。
 */
export const openAiCompatibleAdapter: ProviderAdapter = {
  encodeRequest(req: ChatRequest): unknown {
    const out: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(encodeMessage),
    }
    if (req.tools && req.tools.length > 0) {
      out.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }
    if (req.temperature !== undefined) out.temperature = req.temperature
    return out
  },

  decodeResponse(raw: unknown): ChatResponse {
    const choices = (raw as { choices?: unknown }).choices
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error('OpenAI 响应缺少 choices')
    }
    const choice = choices[0] as {
      message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: OAToolCall[] }
      finish_reason?: string
    }
    const wire = choice.message ?? {}
    const message: AssistantMessage = { role: 'assistant', content: wire.content ?? '' }
    if (wire.reasoning_content) message.reasoning = wire.reasoning_content
    if (wire.tool_calls && wire.tool_calls.length > 0) {
      message.toolCalls = wire.tool_calls.map((tc) => {
        // OpenAI 规范里 arguments 恒为 JSON 字符串；但 glm/deepseek 等兼容供应商偶有偏离
        // （返回已解析对象 / null / 缺失）——归一处理，不抛裸 TypeError。
        const raw: unknown = tc.function?.arguments
        let args: Record<string, unknown>
        if (raw === null || raw === undefined || raw === '') {
          args = {}
        } else if (typeof raw === 'object') {
          args = raw as Record<string, unknown>
        } else if (typeof raw === 'string') {
          try {
            args = raw.trim() === '' ? {} : (JSON.parse(raw) as Record<string, unknown>)
          } catch {
            throw new Error(`tool call arguments 非合法 JSON（${tc.function.name}）: ${raw}`)
          }
        } else {
          throw new Error(`tool call arguments 类型异常（${tc.function.name}）: ${typeof raw}`)
        }
        return { id: tc.id, name: tc.function.name, arguments: args }
      })
    }
    return { message, finishReason: choice.finish_reason ?? 'stop' }
  },
}
