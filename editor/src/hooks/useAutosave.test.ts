import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from './useAutosave'
import { createMemoryGateway } from '../files/memoryGateway'
import { hashSource, type DraftBuffer } from '../state/drafts'

const buf = (path: string, source: string, savedSource: string, dirty: boolean): DraftBuffer =>
  ({ path, source, savedSource, dirty })

const sig = (buffers: DraftBuffer[]) =>
  JSON.stringify(buffers.filter((b) => b.dirty).map((b) => [b.path, b.source]))

const gw = () => createMemoryGateway({ files: {} })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutosave 防抖写', () => {
  it('脏缓冲签名停顿 debounceMs 后写草稿（之前不写）', async () => {
    const gateway = gw()
    const buffers = [buf('a.kin', 'new', 'old', true)]
    renderHook(() => useAutosave({ enabled: true, gateway, projectDir: '/p', buffers, signature: sig(buffers), debounceMs: 1500 }))

    await vi.advanceTimersByTimeAsync(1499)
    expect((await gateway.readDraftStore()).projects['/p']).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    const store = await gateway.readDraftStore()
    expect(store.projects['/p']['a.kin']).toEqual({ source: 'new', base: hashSource('old'), ts: expect.any(Number) })
  })

  it('签名连变只在最后停顿后写一次', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeDraftStore')
    let buffers = [buf('a.kin', 'v1', 'old', true)]
    const { rerender } = renderHook(
      (p: { buffers: DraftBuffer[] }) =>
        useAutosave({ enabled: true, gateway, projectDir: '/p', buffers: p.buffers, signature: sig(p.buffers), debounceMs: 1500 }),
      { initialProps: { buffers } },
    )
    await vi.advanceTimersByTimeAsync(1000)
    buffers = [buf('a.kin', 'v2', 'old', true)]; rerender({ buffers })
    await vi.advanceTimersByTimeAsync(1000)
    expect(writeSpy).not.toHaveBeenCalled() // 中途重置防抖
    await vi.advanceTimersByTimeAsync(500)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect((await gateway.readDraftStore()).projects['/p']['a.kin'].source).toBe('v2')
  })
})

describe('useAutosave 定时兜底', () => {
  it('无签名变化也每 intervalMs 刷一次（有脏）', async () => {
    const gateway = gw()
    const buffers = [buf('a.kin', 'new', 'old', true)]
    // 防抖设很大，确保写来自定时器
    renderHook(() => useAutosave({ enabled: true, gateway, projectDir: '/p', buffers, signature: 'fixed', debounceMs: 1e9, intervalMs: 30000 }))
    await vi.advanceTimersByTimeAsync(30000)
    expect((await gateway.readDraftStore()).projects['/p']['a.kin'].source).toBe('new')
  })

  it('无脏缓冲时定时器不写', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeDraftStore')
    const buffers = [buf('a.kin', 'same', 'same', false)]
    renderHook(() => useAutosave({ enabled: true, gateway, projectDir: '/p', buffers, signature: 'fixed', debounceMs: 1e9, intervalMs: 30000 }))
    await vi.advanceTimersByTimeAsync(60000)
    expect(writeSpy).not.toHaveBeenCalled()
  })
})

describe('useAutosave 保存后清草稿', () => {
  it('缓冲转非脏后下次写删掉其草稿', async () => {
    const gateway = gw()
    let buffers = [buf('a.kin', 'new', 'old', true)]
    const { rerender } = renderHook(
      (p: { buffers: DraftBuffer[] }) =>
        useAutosave({ enabled: true, gateway, projectDir: '/p', buffers: p.buffers, signature: sig(p.buffers), debounceMs: 1000 }),
      { initialProps: { buffers } },
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect((await gateway.readDraftStore()).projects['/p']['a.kin']).toBeDefined()
    // 保存：source===savedSource 且非脏
    buffers = [buf('a.kin', 'new', 'new', false)]; rerender({ buffers })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await gateway.readDraftStore()).projects['/p']).toBeUndefined()
  })
})

describe('useAutosave 禁用 / 清空', () => {
  it('enabled=false 不写草稿', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeDraftStore')
    const buffers = [buf('a.kin', 'new', 'old', true)]
    renderHook(() => useAutosave({ enabled: false, gateway, projectDir: '/p', buffers, signature: sig(buffers), debounceMs: 1000, intervalMs: 30000 }))
    await vi.advanceTimersByTimeAsync(60000)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('paused=true 不写（恢复对话框待决期间，避免抹掉待恢复草稿）', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeDraftStore')
    const buffers = [buf('a.kin', 'new', 'old', true)]
    renderHook(() => useAutosave({ enabled: true, gateway, projectDir: '/p', buffers, signature: sig(buffers), paused: true, debounceMs: 1000, intervalMs: 30000 }))
    await vi.advanceTimersByTimeAsync(60000)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('projectDir=null 不写', async () => {
    const gateway = gw()
    const writeSpy = vi.spyOn(gateway, 'writeDraftStore')
    const buffers = [buf('a.kin', 'new', 'old', true)]
    renderHook(() => useAutosave({ enabled: true, gateway, projectDir: null, buffers, signature: sig(buffers), debounceMs: 1000 }))
    await vi.advanceTimersByTimeAsync(60000)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('clearProjectDrafts 清掉某项目草稿、保留其余', async () => {
    const gateway = gw()
    await gateway.writeDraftStore({
      version: 1,
      projects: {
        '/p1': { 'a.kin': { source: 'A', base: 'b', ts: 1 } },
        '/p2': { 'b.kin': { source: 'B', base: 'b', ts: 2 } },
      },
    })
    const buffers: DraftBuffer[] = []
    const { result } = renderHook(() => useAutosave({ enabled: true, gateway, projectDir: '/p1', buffers, signature: 'x', debounceMs: 1e9 }))
    await result.current.clearProjectDrafts('/p1')
    const store = await gateway.readDraftStore()
    expect(store.projects['/p1']).toBeUndefined()
    expect(store.projects['/p2']).toBeDefined()
  })
})
