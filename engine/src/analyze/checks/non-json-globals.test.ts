import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { checkNonJsonGlobals } from './non-json-globals'

const run = (src: string) => checkNonJsonGlobals([parse(src, 'f.kin')])

describe('checkNonJsonGlobals', () => {
  it('全局 new WeakMap() / new WeakSet() → 一条 non-json-global warning', () => {
    const ds = run('~ let w = new WeakMap()\n=== A ===\n-> END')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.code).toBe('non-json-global')
    expect(ds[0]!.severity).toBe('warning')
    expect(ds[0]!.message).toContain('w')
    expect(ds[0]!.message).toContain('WeakMap')
    expect(run('~ let w = new WeakSet()\n=== A ===\n-> END').map((d) => d.code)).toEqual(['non-json-global'])
  })

  it('全局 new Map() / new Set() / new Date() → 无告警（T076 已白名单编解码保真）', () => {
    expect(run('~ let m = new Map()\n=== A ===\n-> END')).toEqual([])
    expect(run('~ let s = new Set()\n=== A ===\n-> END')).toEqual([])
    expect(run('~ let d = new Date()\n=== A ===\n-> END')).toEqual([])
  })

  it('全局函数声明 → 无诊断（restore 能重建）', () => {
    const ds = run('~~~\nfunction greet(n){ return n }\n~~~\n=== A ===\n-> END')
    expect(ds).toEqual([])
  })

  it('局部（节点内）new WeakMap() → 无诊断（不进快照 globals）', () => {
    const ds = run('=== A ===\n~ let w = new WeakMap()\n-> END')
    expect(ds).toEqual([])
  })

  it('全局普通对象 / 数组 → 无诊断', () => {
    expect(run('~ let o = {}\n=== A ===\n-> END')).toEqual([])
    expect(run('~ let a = []\n=== A ===\n-> END')).toEqual([])
  })

  it('~~~ 块内全局 new WeakMap() 也告警，行号定位到声明行', () => {
    const ds = run('~~~\nlet a = 1\nlet w = new WeakMap()\n~~~\n=== A ===\n-> END')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.line).toBe(3) // new WeakMap() 在第 3 行
  })
})
