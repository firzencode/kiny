import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from './index'

const run = (...srcs: string[]) => analyze(srcs.map((s, i) => parse(s, `f${i}.kin`)))

describe('analyze —— 编排', () => {
  it('合法项目：program 非空、零 error', () => {
    const src = ['~ let gold = 10', '=== A ===', '你有{gold}金币', '-> END'].join('\n')
    const r = run(src)
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.program).not.toBeNull()
    expect(r.program!.knots.has('A')).toBe(true)
    expect(r.program!.globals.has('gold')).toBe(true)
  })
  it('有 error 时 program 为 null、warning 仍在', () => {
    // 未声明变量(error) + 触底(warning)
    const r = run('=== A ===\n{glod}')
    expect(r.program).toBeNull()
    expect(r.diagnostics.some((d) => d.code === 'undeclared-var')).toBe(true)
    expect(r.diagnostics.some((d) => d.code === 'fallthrough')).toBe(true)
  })
  it('仅 warning 时仍产出 program', () => {
    const r = run('=== A ===\n文本') // 仅触底 warning
    expect(r.diagnostics.every((d) => d.severity === 'warning')).toBe(true)
    expect(r.program).not.toBeNull()
  })
})
