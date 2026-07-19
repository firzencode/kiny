import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { errMsg } from '../util/errMsg'
import { runCommand, type ActionCommand, type ActionContext } from './actions'
import { ACTION_MANIFEST, validateCommandArgs } from './actionManifest'

/**
 * webview 侧外部请求路由（T040b-web，spec 2026-07-xx-editor-external-control-design）。
 *
 * Rust 侧（Task 3）跑一个本地 HTTP 服务，把每条请求经 Tauri 事件
 * `external-control://request` 转发进 webview；`handleExternalRequest` 是纯路由，
 * 不依赖 Tauri，可脱离运行时单测；`useExternalControl` 是唯一的桥接副作用，
 * 订阅事件、串行跑路由、经 `invoke('external_control_reply', ...)` 把结果回传 Rust。
 *
 * 复用既有动作层 `runCommand`：不新增/改动作层命令，写类命令不静默写盘（沿用其既有落盘规则）。
 */

/** Rust HTTP proxy 转发过来的一条请求。body 已由 Rust 解析成 JSON（POST）或 null。 */
export interface ExternalRequest { id: string; method: string; path: string; body: unknown }
/** 回给 Rust 的响应；body 是 JSON 字符串。 */
export interface ExternalResponse { id: string; status: number; body: string }

interface HandleDeps { ctx: ActionContext }

function json(id: string, status: number, payload: unknown): ExternalResponse {
  return { id, status, body: JSON.stringify(payload) }
}

/**
 * 项目一致性兜底（防御层）：外部通道不经「离开项目」守卫，随时可能在项目切换中途 dispatch。
 * 处理某请求前捕获当前 projectDir，其命令的 dispatch 校验「仍是同一项目」，不符则丢弃——绝不把
 * 基于旧项目算出的内容写进新项目。正常路径二者恒一致、无副作用。
 */
export function withProjectGuard(ctx: ActionContext): ActionContext {
  const startDir = ctx.getState().projectDir
  return {
    ...ctx,
    dispatch: (a) => {
      if (ctx.getState().projectDir !== startDir) {
        if (import.meta.env.DEV) console.warn('[external] 丢弃跨项目 dispatch：请求处理期间项目已切换')
        return
      }
      ctx.dispatch(a)
    },
  }
}

/**
 * 纯路由：把一条外部请求映射到动作层。可脱离 Tauri 单测。
 * - GET /health   → 项目摘要
 * - GET /commands → ACTION_MANIFEST（自描述真相源）
 * - POST /command → runCommand；命令抛错回 200 + {ok:false,error}（HTTP 语义只表达传输成败）
 * - 其余 → 404
 */
export async function handleExternalRequest(deps: HandleDeps, req: ExternalRequest): Promise<ExternalResponse> {
  const { ctx } = deps
  if (req.method === 'GET' && req.path === '/health') {
    const s = ctx.getState()
    return json(req.id, 200, { ok: true, project: { open: s.projectDir !== null, name: s.manifest?.name ?? null } })
  }
  if (req.method === 'GET' && req.path === '/commands') {
    return json(req.id, 200, ACTION_MANIFEST)
  }
  if (req.method === 'POST' && req.path === '/command') {
    const cmd = req.body as ActionCommand
    if (!cmd || typeof (cmd as { name?: unknown }).name !== 'string') {
      return json(req.id, 400, { ok: false, error: '缺少命令名 name' })
    }
    // 外部输入不可信：执行前按 ACTION_MANIFEST 校验参数（与 agent 循环同一校验）。
    const invalid = validateCommandArgs(cmd as { name: string } & Record<string, unknown>)
    if (invalid) {
      return json(req.id, 400, { ok: false, error: `参数校验失败：${invalid}` })
    }
    try {
      const result = await runCommand(withProjectGuard(ctx), cmd)
      return json(req.id, 200, { ok: true, result: result ?? null })
    } catch (e) {
      return json(req.id, 200, { ok: false, error: errMsg(e) })
    }
  }
  return json(req.id, 404, { ok: false, error: `未知路由: ${req.method} ${req.path}` })
}

/**
 * 桥接 hook：enabled 时订阅 Rust 的 'external-control://request' 事件，
 * 逐条走 handleExternalRequest，再 invoke('external_control_reply') 把结果回传 Rust。
 * 串行处理（一次一条，Promise 链），避免动作层并发改 state。
 */
export function useExternalControl(deps: { ctx: ActionContext; enabled: boolean }): void {
  const { ctx, enabled } = deps
  useEffect(() => {
    if (!enabled) return
    let unlisten: (() => void) | undefined
    let chain: Promise<void> = Promise.resolve()
    let cancelled = false
    listen<ExternalRequest>('external-control://request', (e) => {
      chain = chain.then(async () => {
        if (cancelled) return
        try {
          const res = await handleExternalRequest({ ctx }, e.payload)
          await invoke('external_control_reply', { id: res.id, status: res.status, body: res.body })
        } catch (err) {
          // 单条请求失败（含 invoke 因 Rust 侧已超时驱逐 pending id 而 reject）不得
          // 令 chain 变成 rejected promise，否则后续所有 chain.then(fn) 都不会再跑 fn，
          // 整条外部控制通道死掉。这里吞掉错误，仅记录，链条继续处理下一条请求。
          console.error('[externalControl] 处理请求失败', err)
        }
      })
    }).then((u) => {
      // StrictMode 下 effect 会 mount→cleanup→mount，cleanup 可能在这个 listen()
      // promise resolve 之前就跑完（此时 unlisten 还是 undefined，cleanup 无法取消订阅）。
      // 若 resolve 时已经 cancelled，说明 cleanup 已跑过，直接在这里补跑取消订阅，
      // 避免监听器泄漏；否则按正常路径存起来留给 cleanup 调用。
      if (cancelled) {
        u()
        return
      }
      unlisten = u
    })
    return () => { cancelled = true; unlisten?.() }
  }, [ctx, enabled])
}
