import { describe, it, expect } from 'vitest'
import {
  openAiCompatibleAdapter,
  type ChatRequest,
  type ChatResponse,
  type Message,
  type ToolDefinition,
} from './provider'

const adapter = openAiCompatibleAdapter

/** OpenAI Chat Completions 请求体（只取本测断言用得到的字段）。 */
type OAReq = {
  model: string
  temperature?: number
  messages: Array<{
    role: string
    content: string | null
    tool_call_id?: string
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  }>
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
}

describe('openAiCompatibleAdapter.encodeRequest', () => {
  it('把 system/user 消息映射成 OpenAI messages，并带上 model', () => {
    const req: ChatRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '写个节点' },
      ],
    }
    const out = adapter.encodeRequest(req) as OAReq
    expect(out.model).toBe('gpt-4o')
    expect(out.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '写个节点' },
    ])
  })

  it('tools 未设时不输出 tools 字段；temperature 未设时不输出 temperature 字段', () => {
    const req: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
    const out = adapter.encodeRequest(req) as OAReq
    expect('tools' in out).toBe(false)
    expect('temperature' in out).toBe(false)
  })

  it('temperature 设了就透传', () => {
    const req: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 }
    const out = adapter.encodeRequest(req) as OAReq
    expect(out.temperature).toBe(0.2)
  })

  it('tool-definitions 映射成 type:function 的 tools 数组', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'writeFile',
        description: '写文件',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ]
    const req: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }], tools }
    const out = adapter.encodeRequest(req) as OAReq
    expect(out.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'writeFile',
          description: '写文件',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      },
    ])
  })

  it('assistant 的 toolCalls 映射成 tool_calls，arguments 序列化为 JSON 字符串', () => {
    const req: ChatRequest = {
      model: 'm',
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'writeFile', arguments: { path: 'a.kin', source: 'x' } }],
        },
      ],
    }
    const out = adapter.encodeRequest(req) as OAReq
    const msg = out.messages[0]
    expect(msg.role).toBe('assistant')
    expect(msg.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'writeFile', arguments: JSON.stringify({ path: 'a.kin', source: 'x' }) } },
    ])
  })

  it('assistant 无 toolCalls 时不输出 tool_calls 字段', () => {
    const req: ChatRequest = { model: 'm', messages: [{ role: 'assistant', content: '好的' }] }
    const out = adapter.encodeRequest(req) as OAReq
    expect('tool_calls' in out.messages[0]).toBe(false)
  })

  it('tool-result 消息映射成 role:tool + tool_call_id', () => {
    const req: ChatRequest = {
      model: 'm',
      messages: [{ role: 'tool', toolCallId: 'call_1', content: '{"path":"a.kin"}' }],
    }
    const out = adapter.encodeRequest(req) as OAReq
    expect(out.messages[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"path":"a.kin"}' })
  })
})

describe('openAiCompatibleAdapter.decodeResponse', () => {
  it('纯文本回复 → assistant 消息 + finishReason，无 toolCalls', () => {
    const raw = {
      choices: [{ message: { role: 'assistant', content: '完成了' }, finish_reason: 'stop' }],
    }
    const out: ChatResponse = adapter.decodeResponse(raw)
    expect(out.message).toEqual({ role: 'assistant', content: '完成了' })
    expect(out.message.toolCalls).toBeUndefined()
    expect(out.finishReason).toBe('stop')
  })

  it('带 tool_calls 的回复 → toolCalls 数组，arguments 解析回对象', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_9', type: 'function', function: { name: 'createFile', arguments: '{"path":"b.kin"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const out = adapter.decodeResponse(raw)
    expect(out.message.content).toBe('')
    expect(out.message.toolCalls).toEqual([{ id: 'call_9', name: 'createFile', arguments: { path: 'b.kin' } }])
    expect(out.finishReason).toBe('tool_calls')
  })

  it('reasoning_content（思考型模型）解码到 message.reasoning', () => {
    const raw = {
      choices: [{ message: { role: 'assistant', content: '答案', reasoning_content: '我先这样推理…' }, finish_reason: 'stop' }],
    }
    const out = adapter.decodeResponse(raw)
    expect(out.message.reasoning).toBe('我先这样推理…')
    expect(out.message.content).toBe('答案')
  })

  it('无 reasoning_content 时不带 reasoning 字段', () => {
    const out = adapter.decodeResponse({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] })
    expect('reasoning' in out.message).toBe(false)
  })

  it('content 为 null 时归一成空字符串', () => {
    const raw = { choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }] }
    const out = adapter.decodeResponse(raw)
    expect(out.message.content).toBe('')
  })

  it('空 arguments 字符串解析成空对象', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'validate', arguments: '' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const out = adapter.decodeResponse(raw)
    expect(out.message.toolCalls).toEqual([{ id: 'c1', name: 'validate', arguments: {} }])
  })

  it('arguments 已是对象（部分 glm/deepseek 偏离 OpenAI）→ 原样透传', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'writeFile', arguments: { path: 'a.kin' } } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const out = adapter.decodeResponse(raw)
    expect(out.message.toolCalls).toEqual([{ id: 'c1', name: 'writeFile', arguments: { path: 'a.kin' } }])
  })

  it('arguments 为 null/缺失 → 归一成空对象（不抛裸 TypeError）', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'validate', arguments: null } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    const out = adapter.decodeResponse(raw)
    expect(out.message.toolCalls).toEqual([{ id: 'c1', name: 'validate', arguments: {} }])
  })

  it('没有 choices → 抛错', () => {
    expect(() => adapter.decodeResponse({ choices: [] })).toThrow()
    expect(() => adapter.decodeResponse({})).toThrow()
  })

  it('tool call arguments 非合法 JSON → 抛错', () => {
    const raw = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'writeFile', arguments: '{not json' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    expect(() => adapter.decodeResponse(raw)).toThrow()
  })
})

describe('tool call 往返（IR 边界保真）', () => {
  it('解码出的 assistant.toolCalls 作下一轮请求消息再编码，tool_calls 与原线格式等价', () => {
    const wireToolCalls = [
      { id: 'call_x', type: 'function', function: { name: 'replaceRange', arguments: '{"path":"a.kin","start":0,"end":3,"text":"hi"}' } },
    ]
    const raw = {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: wireToolCalls }, finish_reason: 'tool_calls' }],
    }
    const decoded = adapter.decodeResponse(raw)

    // 把解码得到的 assistant 消息 + 一条 tool-result 回喂进下一轮请求
    const followup: Message[] = [
      decoded.message,
      { role: 'tool', toolCallId: 'call_x', content: '{"path":"a.kin"}' },
    ]
    const req: ChatRequest = { model: 'm', messages: followup }
    const out = adapter.encodeRequest(req) as OAReq

    // 再编码出的 tool_calls 与原始线格式逐字段等价（arguments 重新序列化后语义相同）
    const reEncoded = out.messages[0].tool_calls!
    expect(reEncoded).toHaveLength(1)
    expect(reEncoded[0].id).toBe('call_x')
    expect(reEncoded[0].type).toBe('function')
    expect(reEncoded[0].function.name).toBe('replaceRange')
    expect(JSON.parse(reEncoded[0].function.arguments)).toEqual({ path: 'a.kin', start: 0, end: 3, text: 'hi' })
    // tool-result 透传
    expect(out.messages[1]).toEqual({ role: 'tool', tool_call_id: 'call_x', content: '{"path":"a.kin"}' })
  })
})
