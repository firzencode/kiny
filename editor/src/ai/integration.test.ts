/**
 * 端到端集成测试：假 provider 吐真实工具序列 → 经 {@link runAgentLoop} → 真动作层
 * （真 editorReducer + memoryGateway + 真增量校验器）。
 *
 * 补单测盲区：各单测都用「假 provider + 假依赖」验逻辑片段；这里验整条链路真的把
 * AI 的工具调用落到编辑缓冲——建/改节点落缓冲、标脏、**不静默写盘**、校验回写、
 * saveFile 才落盘、工具失败如实回喂不崩。不需要真 key / 不连网，进闸门每次跑。
 */
import { describe, it, expect } from 'vitest'
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from '../state/editorReducer'
import { createMemoryGateway } from '../files/memoryGateway'
import { STARTER_NEW_FILE } from '../files/gateway'
import { createIncrementalValidator } from '../validate/validate'
import { runAgentLoop, type Provider } from './agentLoop'
import type { ActionContext, PreviewPort, PreviewSnapshot } from './actions'
import type { AssistantMessage, Message } from './provider'

const DIR = '/proj'
const MAIN = `=== 开场 ===
你好。
* [去 A] -> A
=== A ===
A 节点。
-> END`

const INN = `=== 客栈门口 ===
你站在雾港客栈门口。
* [推门进去] -> 大堂
* [转身离开] -> END
=== 大堂 ===
老板擦着杯子。
-> END`

/** 真 reducer + memoryGateway + 真校验器 + 假预览端口；与动作层单测同款。 */
function makeHarness() {
  let state: EditorState = initialEditorState
  const dispatch = (a: EditorAction) => { state = editorReducer(state, a) }
  const gateway = createMemoryGateway({
    files: {
      [`${DIR}/kiny.json`]: JSON.stringify({ name: 'demo', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
      [`${DIR}/main.kin`]: MAIN,
    },
  })
  const snap: PreviewSnapshot = { play: null, stale: false, choiceSeq: [] }
  const preview: PreviewPort = { snapshot: () => snap, choose: () => snap, restart: () => snap }
  const ctx: ActionContext = { getState: () => state, dispatch, gateway, validator: createIncrementalValidator(), preview }
  return { ctx, getState: () => state, gateway }
}

async function loadProject(h: ReturnType<typeof makeHarness>) {
  const proj = await h.gateway.readProject(DIR)
  h.ctx.dispatch({ type: 'project_loaded', project: proj })
}

/** 假 provider：按脚本逐轮返回助手消息；带 toolCalls 的轮触发工具执行，末轮无 toolCalls 收尾。 */
function scriptedProvider(rounds: AssistantMessage[]): Provider {
  let i = 0
  return {
    chat: async () => {
      const message = rounds[Math.min(i, rounds.length - 1)]
      i++
      return { message, finishReason: message.toolCalls?.length ? 'tool_calls' : 'stop' }
    },
  }
}

describe('AI 端到端：工具调用经真动作层落编辑缓冲', () => {
  it('建文件 + 写节点 + 校验：落缓冲、标脏、未写盘、诊断回写、结果回喂', async () => {
    const h = makeHarness()
    await loadProject(h)

    const provider = scriptedProvider([
      {
        role: 'assistant',
        content: '好的，我来建客栈门口与大堂两个节点。',
        toolCalls: [
          { id: 't1', name: 'createFile', arguments: { path: 'chapters/inn' } },
          { id: 't2', name: 'writeFile', arguments: { path: 'chapters/inn.kin', source: INN } },
          { id: 't3', name: 'validate', arguments: {} },
        ],
      },
      { role: 'assistant', content: '已建好，改动在编辑缓冲里，确认后保存。' },
    ])

    const res = await runAgentLoop('在 chapters 下建客栈门口和大堂节点', { provider, ctx: h.ctx, model: 'fake' })

    // 三个工具都执行成功、按序
    expect(res.toolRuns.map((r) => r.call.name)).toEqual(['createFile', 'writeFile', 'validate'])
    expect(res.toolRuns.every((r) => r.ok)).toBe(true)
    // 循环正常收尾、拿到末轮回复
    expect(res.stopped).toBe(false)
    expect(res.reply).toBe('已建好，改动在编辑缓冲里，确认后保存。')
    // 工具结果被作为 tool 消息回喂
    expect(res.messages.some((m: Message) => m.role === 'tool')).toBe(true)

    // 改动落进编辑缓冲 + 标脏
    const buf = h.getState().files['chapters/inn.kin']
    expect(buf.source).toBe(INN)
    expect(buf.dirty).toBe(true)

    // 未静默写盘：磁盘仍是 createFile 的起始模板，不是 writeFile 的内容
    const disk = await h.gateway.readProject(DIR)
    const onDisk = disk.files.find((f) => f.path === 'chapters/inn.kin')
    expect(onDisk?.source).toBe(STARTER_NEW_FILE)
    expect(onDisk?.source).not.toBe(INN)

    // validate 把诊断回写进 state
    expect(Array.isArray(h.getState().diagnostics)).toBe(true)
  })

  it('续一轮 saveFile：把缓冲改动落盘、清脏', async () => {
    const h = makeHarness()
    await loadProject(h)

    // 先建+写（落缓冲）
    const first = await runAgentLoop('建并写 inn', {
      provider: scriptedProvider([
        {
          role: 'assistant', content: '建并写。',
          toolCalls: [
            { id: 'a1', name: 'createFile', arguments: { path: 'chapters/inn' } },
            { id: 'a2', name: 'writeFile', arguments: { path: 'chapters/inn.kin', source: INN } },
          ],
        },
        { role: 'assistant', content: '好了。' },
      ]),
      ctx: h.ctx, model: 'fake',
    })
    expect(h.getState().files['chapters/inn.kin'].dirty).toBe(true)

    // 续话保存（带上一轮历史）
    const history = first.messages.filter((m) => m.role !== 'system')
    await runAgentLoop('保存', {
      provider: scriptedProvider([
        { role: 'assistant', content: '保存。', toolCalls: [{ id: 's1', name: 'saveFile', arguments: { path: 'chapters/inn.kin' } }] },
        { role: 'assistant', content: '已保存。' },
      ]),
      ctx: h.ctx, model: 'fake',
    }, history)

    // 落盘 + 清脏
    expect(h.getState().files['chapters/inn.kin'].dirty).toBe(false)
    const disk = await h.gateway.readProject(DIR)
    expect(disk.files.find((f) => f.path === 'chapters/inn.kin')?.source).toBe(INN)
  })

  it('工具失败（写不存在文件）：该轮 ok=false、错误回喂、循环不崩仍收尾', async () => {
    const h = makeHarness()
    await loadProject(h)

    const res = await runAgentLoop('改不存在的文件', {
      provider: scriptedProvider([
        { role: 'assistant', content: '试着写。', toolCalls: [{ id: 'b1', name: 'writeFile', arguments: { path: '不存在.kin', source: 'x' } }] },
        { role: 'assistant', content: '那个文件不存在，我先列一下项目。' },
      ]),
      ctx: h.ctx, model: 'fake',
    })

    expect(res.toolRuns).toHaveLength(1)
    expect(res.toolRuns[0].ok).toBe(false)
    expect(res.toolRuns[0].result).toMatch(/不存在|error/)
    // 失败结果作为 tool 消息回喂、循环继续到末轮收尾
    expect(res.messages.some((m: Message) => m.role === 'tool')).toBe(true)
    expect(res.stopped).toBe(false)
    expect(res.reply).toContain('不存在')
  })
})
