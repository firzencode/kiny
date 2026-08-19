import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectWatch } from './useProjectWatch'
import { createMemoryGateway } from '../files/memoryGateway'
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from '../state/editorReducer'

const MANIFEST = JSON.stringify({ name: 'p', version: '1.0.0', engine: '0.0.0', entry: 'main.kin' })

function harness(files: Record<string, string>) {
  const watchHook: { fire?: () => void } = {}
  const gw = createMemoryGateway({ files, watchHook })
  let state: EditorState = initialEditorState
  const dispatch = (a: EditorAction) => { state = editorReducer(state, a) }
  return {
    gw, watchHook, dispatch,
    getState: () => state,
    async load() {
      dispatch({ type: 'project_loaded', project: await gw.readProject('/p') })
    },
  }
}

describe('useProjectWatch', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // 微任务排空：fake timers 下推进防抖后，让 rescan 的 await 链走完
  const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }

  it('信号 → 防抖 → 重扫 → dispatch external_sync', async () => {
    const h = harness({ '/p/p.kiw': MANIFEST, '/p/main.kin': 'A' })
    await act(async () => { await h.load() })
    renderHook(() => useProjectWatch({ gateway: h.gw, projectDir: '/p', getState: h.getState, dispatch: h.dispatch }))
    await flush() // 等 watchProject 挂上
    await h.gw.writeFile('/p', 'main.kin', 'B')  // 模拟外部改盘
    act(() => { h.watchHook.fire?.() })
    await flush()
    expect(h.getState().files['main.kin']).toMatchObject({ source: 'B', dirty: false })
  })

  it('信号风暴合并为一次重扫；零变化不 dispatch', async () => {
    const h = harness({ '/p/p.kiw': MANIFEST, '/p/main.kin': 'A' })
    await act(async () => { await h.load() })
    const rescan = vi.spyOn(h.gw, 'rescanProject')
    renderHook(() => useProjectWatch({ gateway: h.gw, projectDir: '/p', getState: h.getState, dispatch: h.dispatch }))
    await flush()
    const runIdBefore = h.getState().runId
    act(() => { h.watchHook.fire?.(); h.watchHook.fire?.(); h.watchHook.fire?.() })
    await flush()
    expect(rescan).toHaveBeenCalledTimes(1)          // 风暴合并
    expect(h.getState().runId).toBe(runIdBefore)      // 零变化 → 未 dispatch
  })

  it('onSynced 每轮重扫后回调（有无 diff 均调）', async () => {
    const h = harness({ '/p/p.kiw': MANIFEST, '/p/main.kin': 'A' })
    await act(async () => { await h.load() })
    const onSynced = vi.fn()
    renderHook(() => useProjectWatch({ gateway: h.gw, projectDir: '/p', getState: h.getState, dispatch: h.dispatch, onSynced }))
    await flush()
    act(() => { h.watchHook.fire?.() })
    await flush()
    expect(onSynced).toHaveBeenCalledTimes(1)
  })

  it('重扫失败（manifest 被删）→ 跳过本轮不炸，下轮恢复', async () => {
    const h = harness({ '/p/p.kiw': MANIFEST, '/p/main.kin': 'A' })
    await act(async () => { await h.load() })
    renderHook(() => useProjectWatch({ gateway: h.gw, projectDir: '/p', getState: h.getState, dispatch: h.dispatch }))
    await flush()
    const rescan = vi.spyOn(h.gw, 'rescanProject').mockRejectedValueOnce(new Error('manifest 没了'))
    act(() => { h.watchHook.fire?.() })
    await flush()   // 本轮吞错
    await h.gw.writeFile('/p', 'main.kin', 'C')
    act(() => { h.watchHook.fire?.() })
    await flush()
    expect(rescan).toHaveBeenCalledTimes(2)
    expect(h.getState().files['main.kin'].source).toBe('C')
  })

  it('卸载 / projectDir 置空 → 退订（fire 不再触发重扫）', async () => {
    const h = harness({ '/p/p.kiw': MANIFEST, '/p/main.kin': 'A' })
    await act(async () => { await h.load() })
    const { unmount } = renderHook(() => useProjectWatch({ gateway: h.gw, projectDir: '/p', getState: h.getState, dispatch: h.dispatch }))
    await flush()
    unmount()
    expect(h.watchHook.fire).toBeUndefined()   // memory 桩退订即清 fire
  })

  it('projectDir=null 不启动监听', async () => {
    const h = harness({ '/p/p.kiw': MANIFEST, '/p/main.kin': 'A' })
    renderHook(() => useProjectWatch({ gateway: h.gw, projectDir: null, getState: h.getState, dispatch: h.dispatch }))
    await flush()
    expect(h.watchHook.fire).toBeUndefined()
  })
})
