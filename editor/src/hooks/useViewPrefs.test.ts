import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewPrefs } from './useViewPrefs'

describe('useViewPrefs · todoCollapsed（T075）', () => {
  beforeEach(() => localStorage.clear())

  it('默认折叠（true）——避免首次挤占节点区', () => {
    const { result } = renderHook(() => useViewPrefs(() => {}))
    expect(result.current.view.todoCollapsed).toBe(true)
  })

  it('切换后持久化到 kiny-editor-view，重载恢复', () => {
    const { result, unmount } = renderHook(() => useViewPrefs(() => {}))
    act(() => result.current.setView((v) => ({ ...v, todoCollapsed: false })))
    expect(JSON.parse(localStorage.getItem('kiny-editor-view')!).todoCollapsed).toBe(false)
    unmount()
    const { result: r2 } = renderHook(() => useViewPrefs(() => {}))
    expect(r2.current.view.todoCollapsed).toBe(false)
  })

  it('旧存储无 todoCollapsed 字段 → 合并默认 true（向后兼容）', () => {
    localStorage.setItem('kiny-editor-view', JSON.stringify({ sidebar: true, preview: true }))
    const { result } = renderHook(() => useViewPrefs(() => {}))
    expect(result.current.view.todoCollapsed).toBe(true)
  })
})
