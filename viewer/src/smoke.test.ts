import { describe, it, expect } from 'vitest'
import { loadProjectFromFiles } from '@kiny/engine'

describe('toolchain', () => {
  it('能解析 engine 公共 API', () => {
    const res = loadProjectFromFiles('not json', new Map())
    expect(res.ok).toBe(false)
  })
})
