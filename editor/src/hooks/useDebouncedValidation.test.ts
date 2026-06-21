import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDebouncedValidation, type ValidationOutcome } from './useDebouncedValidation'

describe('useDebouncedValidation', () => {
  it('runId 变化后等 delay 才跑 run，并把结果交给 onResult', async () => {
    vi.useFakeTimers()
    const run = vi.fn((rid: number): ValidationOutcome => ({ runId: rid, diagnostics: [], program: null }))
    const onResult = vi.fn()
    const { rerender } = renderHook(({ rid }) => useDebouncedValidation(rid, run, onResult, 300), {
      initialProps: { rid: 1 },
    })
    vi.advanceTimersByTime(299)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledWith(1)
    expect(onResult).toHaveBeenCalledWith({ runId: 1, diagnostics: [], program: null })
    rerender({ rid: 2 })
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledWith(2)
    vi.useRealTimers()
  })

  it('runId 快速连变只跑最后一次（前一个计时器被清）', () => {
    vi.useFakeTimers()
    const run = vi.fn((rid: number): ValidationOutcome => ({ runId: rid, diagnostics: [], program: null }))
    const { rerender } = renderHook(({ rid }) => useDebouncedValidation(rid, run, vi.fn(), 300), {
      initialProps: { rid: 1 },
    })
    rerender({ rid: 2 })
    rerender({ rid: 3 })
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(3)
    vi.useRealTimers()
  })
})
