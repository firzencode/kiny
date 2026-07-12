import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup, waitFor } from '@testing-library/react'
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from '../state/editorReducer'
import { createMemoryGateway } from '../files/memoryGateway'
import { createIncrementalValidator } from '../validate/validate'
import type { ActionContext, PreviewPort, PreviewSnapshot } from './actions'
import { handleExternalRequest, useExternalControl, type ExternalRequest } from './externalControl'

// mock Tauri 运行时：useExternalControl 桥接测试用（handleExternalRequest 本身不依赖 Tauri）。
type EventHandler = (e: { payload: ExternalRequest }) => void
const invoke = vi.fn()
const listenMock = vi.fn()
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listenMock(...a) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

const DIR = '/proj'
const MAIN = `=== start ===
你好。
-> END`

/** 搭一套真 reducer + memoryGateway + 真校验器 + 假预览端口的测试上下文（同 actions.test.ts 的 harness）。 */
async function makeCtx() {
  let state: EditorState = initialEditorState
  const dispatch = (a: EditorAction) => { state = editorReducer(state, a) }
  const gateway = createMemoryGateway({
    files: {
      [`${DIR}/kiny.json`]: JSON.stringify({ name: 'p', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
      [`${DIR}/main.kin`]: MAIN,
    },
  })
  const snap: PreviewSnapshot = { play: null, stale: false, interactionSeq: [] }
  const preview: PreviewPort = { snapshot: () => snap, choose: () => snap, submitInput: () => snap, restart: () => snap }
  const ctx: ActionContext = { getState: () => state, dispatch, gateway, validator: createIncrementalValidator(), preview }
  // 打开项目：走真实前置（gateway 读盘 + project_loaded），listProject/health 才能看到已打开项目。
  const proj = await gateway.readProject(DIR)
  dispatch({ type: 'project_loaded', project: proj })
  return { ctx, getState: () => state }
}

describe('handleExternalRequest', () => {
  it('GET /health 回项目摘要', async () => {
    const { ctx } = await makeCtx()
    const r = await handleExternalRequest({ ctx }, { id: '1', method: 'GET', path: '/health', body: null })
    expect(r.status).toBe(200)
    const j = JSON.parse(r.body)
    expect(j.ok).toBe(true)
    expect(j.project.open).toBe(true)
    expect(j.project.name).toBe('p')
  })

  it('GET /commands 回 ACTION_MANIFEST', async () => {
    const { ctx } = await makeCtx()
    const r = await handleExternalRequest({ ctx }, { id: '2', method: 'GET', path: '/commands', body: null })
    const cmds = JSON.parse(r.body)
    expect(Array.isArray(cmds)).toBe(true)
    expect(cmds.find((c: { name: string }) => c.name === 'writeFile')).toBeTruthy()
  })

  it('POST /command 执行命令、ok:true', async () => {
    const { ctx } = await makeCtx()
    const r = await handleExternalRequest({ ctx }, { id: '3', method: 'POST', path: '/command', body: { name: 'listProject' } })
    const j = JSON.parse(r.body)
    expect(j.ok).toBe(true)
    expect(j.result.projectDir).toBe(DIR)
  })

  it('POST /command 命令抛错 → 200 + ok:false（不抛 HTTP 错）', async () => {
    const { ctx } = await makeCtx()
    const r = await handleExternalRequest({ ctx }, { id: '4', method: 'POST', path: '/command', body: { name: 'readFile', path: 'nope.kin' } })
    expect(r.status).toBe(200)
    const j = JSON.parse(r.body)
    expect(j.ok).toBe(false)
    expect(j.error).toMatch(/不存在/)
  })

  it('未知路由 → 404', async () => {
    const { ctx } = await makeCtx()
    const r = await handleExternalRequest({ ctx }, { id: '5', method: 'GET', path: '/nope', body: null })
    expect(r.status).toBe(404)
  })
})

describe('useExternalControl', () => {
  afterEach(() => {
    cleanup()
    invoke.mockReset()
    listenMock.mockReset()
  })

  it('一条请求的 invoke 回复被 reject（如 Rust 侧已超时驱逐 pending id）不阻塞后续请求处理', async () => {
    const { ctx } = await makeCtx()
    let handler: EventHandler | undefined
    const unlistenFn = vi.fn()
    listenMock.mockImplementation((_ev: string, h: EventHandler) => {
      handler = h
      return Promise.resolve(unlistenFn)
    })
    invoke.mockRejectedValueOnce(new Error('pending id 已被 Rust 端超时驱逐'))
    invoke.mockResolvedValueOnce(undefined)

    renderHook(() => useExternalControl({ ctx, enabled: true }))
    await waitFor(() => expect(handler).toBeDefined())

    handler!({ payload: { id: '1', method: 'GET', path: '/health', body: null } })
    handler!({ payload: { id: '2', method: 'GET', path: '/health', body: null } })

    // 第一条的 invoke reject 不应毒化 chain：第二条仍须被处理、仍须调用 invoke 回复。
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke.mock.calls[0][1]).toMatchObject({ id: '1' })
    expect(invoke.mock.calls[1][1]).toMatchObject({ id: '2' })
  })

  it('cleanup 早于 listen() resolve（StrictMode mount→cleanup→mount 场景）时不泄漏监听器', async () => {
    const { ctx } = await makeCtx()
    const unlistenFn = vi.fn()
    let resolveListen: ((u: () => void) => void) | undefined
    listenMock.mockImplementation(() => new Promise<() => void>((resolve) => { resolveListen = resolve }))

    const { unmount } = renderHook(() => useExternalControl({ ctx, enabled: true }))
    await waitFor(() => expect(resolveListen).toBeDefined())
    unmount() // cleanup 跑在 listen() resolve 之前：此时 unlisten 局部变量仍是 undefined
    resolveListen!(unlistenFn) // listen() 才 resolve

    // 若无 cancelled 补跑，unlistenFn 永远不会被调用（监听器泄漏）。
    await waitFor(() => expect(unlistenFn).toHaveBeenCalledTimes(1))
  })
})
