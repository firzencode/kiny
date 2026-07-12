// editor/src/ai/externalControlLifecycle.ts
//
// 外部控制 start 的决策逻辑，从 App.tsx 的 useEffect 中抽出以便脱离 React/Tauri 环境单测。
// control.json 由 Rust 侧持有（start 写 / stop 删），前端不再碰文件。start 返回代际号，
// 补偿 stop 带上它——dev StrictMode 双挂载下，落后一代的 start resolve 时若效果已 cancelled，
// 其补偿 stop 只停「自己那一代」（Rust stop_matches 保证不误杀更新的一代的 server）。

/** start 分支依赖的最小接口：与真实 invoke 的形状对齐，测试可注入桩。 */
export interface ExternalControlStartDeps {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  /** 每次调用时读取效果是否已被清理（对应 React effect 里的 `cancelled` 标记）。 */
  isCancelled: () => boolean
}

export type ExternalControlStartResult =
  | { kind: 'started'; info: { port: number; generation: number } }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

/**
 * 起外部控制服务的决策流程：调 start_external_control。
 * - invoke 失败：返回 `error`（调用方据此弹通知），不抛出。
 * - resolve 时效果已 cancelled：Rust 侧 server 已经起了，发一条**代际安全**的补偿
 *   stop_external_control（带本次的 generation）——Rust 只停自己那一代、并删控制文件；
 *   best-effort（失败只记日志、不升级为通知，因效果已作废），返回 `cancelled`。
 * - 否则返回 `started` + info（{port, generation}），调用方据此落 controlInfo / 代际号。
 */
export async function runExternalControlStart(deps: ExternalControlStartDeps): Promise<ExternalControlStartResult> {
  let info: { port: number; generation: number }
  try {
    info = await deps.invoke<{ port: number; generation: number }>('start_external_control')
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
  if (deps.isCancelled()) {
    try {
      await deps.invoke('stop_external_control', { generation: info.generation })
    } catch (e) {
      console.error('补偿停止外部控制失败', e)
    }
    return { kind: 'cancelled' }
  }
  return { kind: 'started', info }
}
