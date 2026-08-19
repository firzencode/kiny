import { useEffect, useRef } from 'react'
import type { FileGateway } from '../files/gateway'
import { computeExternalSync } from '../files/rescan'
import type { EditorAction, EditorState } from '../state/editorReducer'

export interface UseProjectWatchOptions {
  gateway: FileGateway
  projectDir: string | null
  /** 读最新已提交 state（App 传 committedStateRef）——重扫回来时闭包 state 可能已过期。 */
  getState: () => EditorState
  dispatch: (a: EditorAction) => void
  /** 每完成一轮重扫（无论有无 diff）回调：媒体预览缓存计数用（二进制内容变化 diff 看不见）。 */
  onSynced?: () => void
  debounceMs?: number
}

/**
 * 项目目录外部变更监听（spec：2026-08-15-editor-project-watch-design）。
 * watch 事件只当「项目变了」的信号：防抖合并事件风暴后重扫目录、与内存状态 diff，
 * 一次 dispatch 应用。editor 自己保存的回环在 diff 里天然消化（磁盘 == savedSource）。
 * watcher 起不来只降级告警——监听是增强，不该拦住编辑。
 */
export function useProjectWatch(opts: UseProjectWatchOptions): void {
  const { gateway, projectDir, debounceMs = 200 } = opts
  // 热值走 ref：getState/dispatch/onSynced 每渲染都是新引用，不能进 effect 依赖（会反复重挂 watcher）。
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (projectDir === null) return
    let disposed = false
    let unwatch: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let scanning = false
    let pending = false

    const rescan = async (): Promise<void> => {
      if (scanning) { pending = true; return }   // 不并发扫；扫完补一轮
      scanning = true
      try {
        do {
          pending = false
          const snapshot = await gateway.rescanProject(projectDir)
          if (disposed) return
          const cur = optsRef.current.getState()
          if (cur.projectDir !== projectDir) return   // 项目已切换：过期扫描直接丢弃
          const payload = computeExternalSync(cur, snapshot)
          if (payload !== null) optsRef.current.dispatch({ type: 'external_sync', sync: payload })
          optsRef.current.onSynced?.()
        } while (pending && !disposed)
      } catch (e) {
        console.warn('[kiny] 项目重扫失败，跳过本轮外部同步', e)
      } finally {
        scanning = false
      }
    }

    const onSignal = (): void => {
      if (disposed) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void rescan() }, debounceMs)
    }

    void gateway.watchProject(projectDir, onSignal)
      .then((un) => { if (disposed) un(); else unwatch = un })
      .catch((e) => { console.warn('[kiny] 项目监听不可用，外部改动将不会自动同步', e) })

    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      unwatch?.()
    }
  }, [gateway, projectDir, debounceMs])
}
