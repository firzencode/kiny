import { useCallback, useEffect, useRef } from 'react'
import type { FileGateway } from '../files/gateway'
import { reconcileProjectDrafts, clearProjectDrafts as clearDrafts, type DraftBuffer, type DraftStore } from '../state/drafts'

export interface UseAutosaveOptions {
  /** 自动恢复草稿开关（设置项，默认开）。关则不写草稿、不做对账。 */
  enabled: boolean
  gateway: Pick<FileGateway, 'readDraftStore' | 'writeDraftStore'>
  projectDir: string | null
  /** 当前项目全部 .kin 缓冲（脏的写草稿、非脏的清草稿）。 */
  buffers: DraftBuffer[]
  /** 脏缓冲内容签名：变化即重置防抖（停手 debounceMs 后写一次）。 */
  signature: string
  /** 暂停持久化（如恢复对话框待决期间）：不写、不删，避免抹掉磁盘上待恢复的草稿。 */
  paused?: boolean
  debounceMs?: number
  intervalMs?: number
}

export interface AutosaveApi {
  /** 立即对账并写草稿（关闭前 flush / 测试用）。 */
  flush(): Promise<void>
  /** 清空某项目草稿（恢复对话框「丢弃」、干净退出用）。 */
  clearProjectDrafts(dir: string): Promise<void>
}

/**
 * 自动保存恢复草稿（spec §3）：脏缓冲在后台写独立草稿（落 app-data，不碰真文件）。
 * - 防抖（主）：脏缓冲内容停顿 debounceMs（默认 1.5s）后写。
 * - 定时兜底：每 intervalMs（默认 30s），若仍有脏缓冲则强制刷一次（覆盖长时间不停顿编辑）。
 * 对账式写：每次写都「脏→草稿、非脏→删草稿」，故保存 / 丢弃后下次对账自动清掉对应草稿。
 * store 载一次入内存（storeRef），后续在其上对账——避免覆盖其他项目的草稿。
 */
export function useAutosave(opts: UseAutosaveOptions): AutosaveApi {
  const { enabled, gateway, projectDir, signature, paused = false, debounceMs = 1500, intervalMs = 30000 } = opts
  const storeRef = useRef<DraftStore | null>(null)
  const buffersRef = useRef(opts.buffers); buffersRef.current = opts.buffers
  const projectDirRef = useRef(projectDir); projectDirRef.current = projectDir
  const gatewayRef = useRef(gateway); gatewayRef.current = gateway

  const ensureLoaded = useCallback(async (): Promise<DraftStore> => {
    if (storeRef.current == null) storeRef.current = await gatewayRef.current.readDraftStore()
    return storeRef.current
  }, [])

  const persist = useCallback(async (): Promise<void> => {
    const dir = projectDirRef.current
    if (!dir) return
    const store = await ensureLoaded()
    storeRef.current = reconcileProjectDrafts(store, dir, buffersRef.current, Date.now())
    await gatewayRef.current.writeDraftStore(storeRef.current)
  }, [ensureLoaded])

  const clearProjectDrafts = useCallback(async (dir: string): Promise<void> => {
    const store = await ensureLoaded()
    storeRef.current = clearDrafts(store, dir)
    await gatewayRef.current.writeDraftStore(storeRef.current)
  }, [ensureLoaded])

  // 防抖写：脏缓冲签名变化后等 debounceMs（停手才写）。paused 时不调度，避免抹掉待恢复草稿。
  useEffect(() => {
    if (!enabled || !projectDir || paused) return
    const h = setTimeout(() => { void persist() }, debounceMs)
    return () => clearTimeout(h)
  }, [enabled, projectDir, paused, signature, debounceMs, persist])

  // 定时兜底：每 intervalMs，有脏才刷一次。
  useEffect(() => {
    if (!enabled || !projectDir || paused) return
    const h = setInterval(() => { if (buffersRef.current.some((b) => b.dirty)) void persist() }, intervalMs)
    return () => clearInterval(h)
  }, [enabled, projectDir, paused, intervalMs, persist])

  return { flush: persist, clearProjectDrafts }
}
