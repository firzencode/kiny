import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { checkNames } from './names'

const run = (...srcs: string[]) => checkNames(srcs.map((s, i) => parse(s, `f${i}.kin`)))

describe('checkNames', () => {
  it('正例：无重名零诊断', () => {
    expect(run('=== A ===\n= s\n-> END\n=== B ===\n-> END')).toEqual([])
  })
  it('跨文件节点重名报 duplicate-knot', () => {
    const ds = run('=== A ===\n-> END', '=== A ===\n-> END')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.code).toBe('duplicate-knot')
    expect(ds[0]!.file).toBe('f1.kin')
  })
  it('同父内子节点重名报 duplicate-stitch', () => {
    const ds = run('=== A ===\n= s\n-> END\n= s\n-> END')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.code).toBe('duplicate-stitch')
  })
  it('不同父节点同名子节点不报', () => {
    expect(run('=== A ===\n= s\n-> END\n=== B ===\n= s\n-> END')).toEqual([])
  })
})
