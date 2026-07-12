import { describe, it, expect, vi } from 'vitest'
import { runExternalControlStart, type ExternalControlStartDeps } from './externalControlLifecycle'

const INFO = { port: 4321, generation: 7 }

/** 造一套可控依赖：invoke 按命令名分派并记 (cmd, args)。control.json 由 Rust 持有，前端不再写/删。 */
function makeDeps(overrides: {
  cancelled?: boolean
  startResolves?: { port: number; generation: number } | Error
  stopResolves?: 'ok' | Error
} = {}) {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = []
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cmd, args })
    if (cmd === 'start_external_control') {
      const r = overrides.startResolves ?? INFO
      if (r instanceof Error) throw r
      return r
    }
    if (cmd === 'stop_external_control') {
      if (overrides.stopResolves instanceof Error) throw overrides.stopResolves
      return undefined
    }
    throw new Error(`unexpected invoke: ${cmd}`)
  })
  const deps: ExternalControlStartDeps = {
    invoke: invoke as unknown as ExternalControlStartDeps['invoke'],
    isCancelled: () => overrides.cancelled ?? false,
  }
  return { deps, invoke, calls }
}

describe('runExternalControlStart', () => {
  it('未取消：start 成功 → 返回 started + info（不发补偿 stop，文件由 Rust 写）', async () => {
    const { deps, invoke } = makeDeps({ cancelled: false })
    const result = await runExternalControlStart(deps)
    expect(result).toEqual({ kind: 'started', info: INFO })
    expect(invoke).toHaveBeenCalledTimes(1) // 只有 start，没有补偿 stop
    expect(invoke).toHaveBeenCalledWith('start_external_control')
  })

  it('start 调用失败（invoke reject）→ 返回 error，不发 stop', async () => {
    const { deps, invoke } = makeDeps({ startResolves: new Error('拒绝连接') })
    const result = await runExternalControlStart(deps)
    expect(result).toEqual({ kind: 'error', message: '拒绝连接' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('start 成功但效果已 cancelled → 代际安全的补偿 stop（带自己那一代 generation），返回 cancelled', async () => {
    const { deps, invoke, calls } = makeDeps({ cancelled: true })
    const result = await runExternalControlStart(deps)
    expect(result).toEqual({ kind: 'cancelled' })
    // 补偿 stop 必须带 generation，Rust 侧据此只停自己那一代、不误杀更新的一代。
    expect(invoke).toHaveBeenCalledWith('stop_external_control', { generation: INFO.generation })
    expect(calls).toEqual([
      { cmd: 'start_external_control', args: undefined },
      { cmd: 'stop_external_control', args: { generation: INFO.generation } },
    ])
  })

  it('cancelled 路径下补偿 stop 失败：不抛出、仍返回 cancelled', async () => {
    const { deps } = makeDeps({ cancelled: true, stopResolves: new Error('stop 超时') })
    await expect(runExternalControlStart(deps)).resolves.toEqual({ kind: 'cancelled' })
  })
})
