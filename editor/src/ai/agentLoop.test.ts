import { describe, it, expect } from 'vitest'
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from '../state/editorReducer'
import { createMemoryGateway } from '../files/memoryGateway'
import { createIncrementalValidator } from '../validate/validate'
import { type ActionContext, type PreviewPort, type PreviewSnapshot } from './actions'
import type { ChatRequest, ChatResponse, ToolCall } from './provider'
import { runAgentLoop, buildSystemPrompt, type Provider } from './agentLoop'

const DIR = '/proj'
const MAIN = `=== 开场 ===
你好。
-> END`

/** 真 reducer + memoryGateway + 真校验器 + 假预览端口的动作层上下文（同 actions.test.ts）。 */
function makeCtx(files: Record<string, string> = {}) {
  let state: EditorState = initialEditorState
  const dispatch = (a: EditorAction) => { state = editorReducer(state, a) }
  const gateway = createMemoryGateway({
    files: {
      [`${DIR}/kiny.json`]: JSON.stringify({ name: 'demo', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
      [`${DIR}/main.kin`]: MAIN,
      ...files,
    },
  })
  const validator = createIncrementalValidator()
  const snap: PreviewSnapshot = { play: null, stale: false, choiceSeq: [] }
  const preview: PreviewPort = { snapshot: () => snap, choose: () => snap, restart: () => snap }
  const ctx: ActionContext = { getState: () => state, dispatch, gateway, validator, preview }
  return { ctx, getState: () => state, gateway }
}

async function loadProject(h: ReturnType<typeof makeCtx>) {
  const proj = await h.gateway.readProject(DIR)
  h.ctx.dispatch({ type: 'project_loaded', project: proj })
}

/** 脚本化假 provider：按预设依次返回响应，并记录每次收到的请求。 */
function scriptedProvider(responses: ChatResponse[]) {
  const requests: ChatRequest[] = []
  let i = 0
  const provider: Provider = {
    async chat(req) {
      requests.push(req)
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return r
    },
  }
  return { provider, requests }
}

function asst(content: string, toolCalls?: ToolCall[]): ChatResponse {
  return { message: { role: 'assistant', content, ...(toolCalls ? { toolCalls } : {}) }, finishReason: toolCalls ? 'tool_calls' : 'stop' }
}

describe('buildSystemPrompt', () => {
  it('含 Kin 语言知识与当前项目上下文（projectDir + 文件清单）', async () => {
    const h = makeCtx({ [`${DIR}/chapters/a.kin`]: '=== 起 ===\n-> END' })
    await loadProject(h)
    const sys = buildSystemPrompt(h.ctx)
    // Kin 知识标志
    expect(sys).toMatch(/Kin/)
    expect(sys).toMatch(/===/) // 节点语法
    // 项目上下文
    expect(sys).toContain(DIR)
    expect(sys).toContain('main.kin')
    expect(sys).toContain('chapters/a.kin')
  })

  it('注入自定义 Kin 知识时透传', async () => {
    const h = makeCtx()
    await loadProject(h)
    const sys = buildSystemPrompt(h.ctx, '【自定义知识】')
    expect(sys).toContain('【自定义知识】')
  })
})

describe('runAgentLoop · 一轮 prompt→toolcall→执行→回喂→完成', () => {
  it('执行 createFile 命令、结果回喂、迭代到无 tool call 输出最终回复', async () => {
    const h = makeCtx()
    await loadProject(h)
    const { provider, requests } = scriptedProvider([
      asst('', [{ id: 'c1', name: 'createFile', arguments: { path: 'chapters/new.kin' } }]),
      asst('已经为你创建了 chapters/new.kin。'),
    ])

    const res = await runAgentLoop('建个新章节文件', { provider, ctx: h.ctx, model: 'm' })

    // 命令真正执行：动作层经 gateway 建了文件、并 dispatch 进 state
    expect(h.getState().files['chapters/new.kin']).toBeDefined()
    // 结果回喂：messages 含对应 tool-result
    const toolMsg = res.messages.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg && 'toolCallId' in toolMsg && toolMsg.toolCallId).toBe('c1')
    expect(toolMsg && 'content' in toolMsg && toolMsg.content).toContain('chapters/new.kin')
    // 第二次请求带上了 tool-result（回喂证据）
    expect(requests).toHaveLength(2)
    expect(requests[1].messages.some((m) => m.role === 'tool')).toBe(true)
    // 终态
    expect(res.reply).toBe('已经为你创建了 chapters/new.kin。')
    expect(res.stopped).toBe(false)
    expect(res.toolRuns).toHaveLength(1)
    expect(res.toolRuns[0].ok).toBe(true)
  })

  it('第一次请求带 system 提示与 tool-definitions', async () => {
    const h = makeCtx()
    await loadProject(h)
    const { provider, requests } = scriptedProvider([asst('好的。')])
    await runAgentLoop('你好', { provider, ctx: h.ctx, model: 'gpt-x' })
    expect(requests[0].model).toBe('gpt-x')
    expect(requests[0].messages[0].role).toBe('system')
    expect(requests[0].tools && requests[0].tools.length).toBeGreaterThan(0)
    expect(requests[0].tools!.some((t) => t.name === 'writeFile')).toBe(true)
    // 用户 prompt 进了消息
    expect(requests[0].messages.some((m) => m.role === 'user' && m.content === '你好')).toBe(true)
  })

  it('命令执行失败 → 错误作 tool-result 回喂（ok=false），循环继续', async () => {
    const h = makeCtx()
    await loadProject(h)
    const { provider } = scriptedProvider([
      asst('', [{ id: 'c1', name: 'readFile', arguments: { path: '不存在.kin' } }]),
      asst('那个文件不存在。'),
    ])
    const res = await runAgentLoop('读不存在的文件', { provider, ctx: h.ctx, model: 'm' })
    expect(res.toolRuns[0].ok).toBe(false)
    expect(res.toolRuns[0].result).toMatch(/error|不存在/)
    expect(res.reply).toBe('那个文件不存在。')
  })

  it('onEvent 实时回调：中间叙述 + 每个工具执行（供 UI 边跑边显）', async () => {
    const h = makeCtx()
    await loadProject(h)
    const { provider } = scriptedProvider([
      asst('我先建两个文件。', [
        { id: 'c1', name: 'createFile', arguments: { path: 'a.kin' } },
        { id: 'c2', name: 'createFile', arguments: { path: 'b.kin' } },
      ]),
      asst('建好了。'),
    ])
    const events: string[] = []
    await runAgentLoop('建俩', { provider, ctx: h.ctx, model: 'm', onEvent: (e) => {
      events.push(e.type === 'tool' ? `tool:${e.record.call.name}:${e.record.ok}` : `say:${e.content}`)
    } })
    // 顺序：先中间叙述，再两个工具，最后收尾叙述
    expect(events).toEqual(['say:我先建两个文件。', 'tool:createFile:true', 'tool:createFile:true', 'say:建好了。'])
  })

  it('一轮里多个 toolCalls 全部执行并各自回喂', async () => {
    const h = makeCtx()
    await loadProject(h)
    const { provider } = scriptedProvider([
      asst('', [
        { id: 'c1', name: 'createFile', arguments: { path: 'a.kin' } },
        { id: 'c2', name: 'createFile', arguments: { path: 'b.kin' } },
      ]),
      asst('建好了两个。'),
    ])
    const res = await runAgentLoop('建两个文件', { provider, ctx: h.ctx, model: 'm' })
    expect(h.getState().files['a.kin']).toBeDefined()
    expect(h.getState().files['b.kin']).toBeDefined()
    expect(res.toolRuns).toHaveLength(2)
    const toolMsgs = res.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
  })
})

describe('runAgentLoop · 可停止', () => {
  it('signal abort 后在安全点退出、返回 stopped=true', async () => {
    const h = makeCtx()
    await loadProject(h)
    const controller = new AbortController()
    let calls = 0
    // 永远要求调工具的 provider；第二次请求时触发 abort
    const provider: Provider = {
      async chat() {
        calls++
        if (calls >= 2) controller.abort()
        return asst('', [{ id: `c${calls}`, name: 'validate', arguments: {} }])
      },
    }
    const res = await runAgentLoop('无限', { provider, ctx: h.ctx, model: 'm', signal: controller.signal })
    expect(res.stopped).toBe(true)
    expect(calls).toBeLessThanOrEqual(2)
  })

  it('provider 在中途 abort 时 reject（AbortError）→ 循环吞掉返回 stopped，不外抛', async () => {
    const h = makeCtx()
    await loadProject(h)
    const controller = new AbortController()
    const provider: Provider = {
      async chat() {
        controller.abort()
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      },
    }
    const res = await runAgentLoop('x', { provider, ctx: h.ctx, model: 'm', signal: controller.signal })
    expect(res.stopped).toBe(true)
  })

  it('中途 abort 后不留悬空的带 toolCalls 助手消息（messages 可作 history 续话）', async () => {
    const h = makeCtx()
    await loadProject(h)
    const controller = new AbortController()
    const provider: Provider = {
      async chat() {
        controller.abort() // 本次响应返回后即处于 aborted
        return asst('', [{ id: 'c1', name: 'validate', arguments: {} }])
      },
    }
    const res = await runAgentLoop('x', { provider, ctx: h.ctx, model: 'm', signal: controller.signal })
    expect(res.stopped).toBe(true)
    const last = res.messages[res.messages.length - 1]
    const dangling = last.role === 'assistant' && !!last.toolCalls && last.toolCalls.length > 0
    expect(dangling).toBe(false)
  })

  it('开局前已 abort → 不调 provider，直接 stopped', async () => {
    const h = makeCtx()
    await loadProject(h)
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const provider: Provider = { async chat() { calls++; return asst('x') } }
    const res = await runAgentLoop('hi', { provider, ctx: h.ctx, model: 'm', signal: controller.signal })
    expect(res.stopped).toBe(true)
    expect(calls).toBe(0)
  })
})
