import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useExternalControl } from '../ai/externalControl'
import { runExternalControlStart } from '../ai/externalControlLifecycle'
import type { ActionContext } from '../ai/actions'

/**
 * 外部控制（T040）服务开关的运行态与生命周期。
 * `active` 由调用方按 `settings.externalControl && windowMode === 'editor'` 传入——外部控制只在真正的
 * 编辑窗参与（启动窗 / web-SPA 无 Tauri，不起服务）。开→起 Rust HTTP 服务、关→代际安全地停自己那一代。
 *
 * control.json 生命周期由 Rust 持有（文件存在 ⟺ 端口在监听）；start/stop 带代际号，令 dev
 * StrictMode 双挂载下旧代际的补偿 stop 不误杀新代际的 server（详见 externalControlLifecycle.ts）。
 */
export function useExternalControlToggle(
  ctx: ActionContext,
  active: boolean,
  setNotice: (msg: string | null, tone?: 'error' | 'success') => void,
): { controlInfo: { port: number } | null } {
  // 外部控制运行态（T040）：非 null = 服务已起，含端口；随 active 联动 start/stop。
  const [controlInfo, setControlInfo] = useState<{ port: number } | null>(null)
  const controlGenRef = useRef<number | null>(null) // 当前在跑服务的代际号；关闭时据此代际安全地停自己那一代

  useExternalControl({ ctx, enabled: active })

  useEffect(() => {
    let cancelled = false
    if (active) {
      void (async () => {
        const result = await runExternalControlStart({ invoke, isCancelled: () => cancelled })
        if (result.kind === 'started') {
          controlGenRef.current = result.info.generation
          if (!cancelled) setControlInfo({ port: result.info.port })
        } else if (result.kind === 'error' && !cancelled) {
          // 仅对「本效果仍在生效」的失败弹通知：dev StrictMode 双挂载下，被清理的那一代
          // start 会因自我超代返回良性 error（已被更新的一代取代），此时 cancelled=true，
          // 不该弹「启用失败」误导用户——真正的 bind 失败发生在未被取消的当代，仍会弹。
          setNotice(`启用外部控制失败：${result.message}`)
        }
        // 'cancelled'：runExternalControlStart 内部已发代际安全的补偿 stop（Rust 删文件），此处无需再做。
      })()
    } else if (controlGenRef.current !== null) {
      const gen = controlGenRef.current
      controlGenRef.current = null
      void (async () => {
        try {
          await invoke('stop_external_control', { generation: gen })
        } catch (e) {
          console.error('停止外部控制失败', e)
        } finally {
          if (!cancelled) setControlInfo(null)
        }
      })()
    }
    return () => { cancelled = true }
  }, [active])

  return { controlInfo }
}
