import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { buildSymbolTable } from '../symbols'
import { checkLabels } from './labels'

const run = (src: string) => checkLabels(buildSymbolTable([parse(src, 'f.kin')]))

describe('checkLabels', () => {
  it('正例零诊断', () => {
    expect(run('=== A ===\n* (a) [x]\n* (b) [y]\n-> END')).toEqual([])
  })
  it('标签重名报 duplicate-label，且报在第二次出现的行', () => {
    const ds = run('=== A ===\n* (a) [x]\n* (a) [y]\n-> END')
    const dup = ds.filter((d) => d.code === 'duplicate-label')
    expect(dup).toHaveLength(1)
    expect(dup[0]!.line).toBe(3)
  })
  it('标签撞变量报 label-var-collision', () => {
    const ds = run('~ let greet = 0\n=== A ===\n* (greet) [x]\n-> END')
    expect(ds.map((d) => d.code)).toContain('label-var-collision')
  })
  it('标签撞节点局部变量也报 label-var-collision', () => {
    const ds = run('=== A ===\n~ let greet = 0\n* (greet) [x]\n-> END')
    expect(ds.map((d) => d.code)).toContain('label-var-collision')
  })
})
