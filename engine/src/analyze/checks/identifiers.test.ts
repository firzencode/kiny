import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { buildSymbolTable } from '../symbols'
import { checkIdentifiers } from './identifiers'

const run = (src: string) => checkIdentifiers(buildSymbolTable([parse(src, 'f.kin')]))

describe('checkIdentifiers', () => {
  it('正例零诊断', () => {
    expect(run('~ let gold = 10\n=== A ===\n* (greet) [嗨]\n-> END')).toEqual([])
  })
  it('保留字作变量名报 reserved-identifier', () => {
    const ds = run('~ let random = 1\n=== A ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('reserved-identifier')
  })
  it('保留字作标签报 reserved-identifier', () => {
    const ds = run('=== A ===\n* (turns) [嗨]\n-> END')
    expect(ds.map((d) => d.code)).toContain('reserved-identifier')
  })
  it('中文变量名报 non-ascii-identifier', () => {
    const ds = run('~ let 金币 = 10\n=== A ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('non-ascii-identifier')
  })
  it('保留字作参数名报 reserved-identifier', () => {
    const ds = run('=== A(random) ===\n-> END')
    expect(ds.map((d) => d.code)).toContain('reserved-identifier')
  })
})
