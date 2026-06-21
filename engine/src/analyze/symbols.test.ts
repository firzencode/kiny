import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { buildSymbolTable } from './symbols'

const tbl = (...srcs: string[]) => buildSymbolTable(srcs.map((s, i) => parse(s, `f${i}.kin`)))

describe('buildSymbolTable', () => {
  it('knots / stitches 入表', () => {
    const t = tbl('=== A ===\n= s1\n-> END\n=== B ===\n-> END')
    expect([...t.knots.keys()].sort()).toEqual(['A', 'B'])
    expect(t.stitches.get('A')!.has('s1')).toBe(true)
  })
  it('preamble let → global，节点内 let → local', () => {
    const t = tbl('~ let gold = 10\n=== A ===\n~ let dice = 0\n-> END')
    expect(t.globals.has('gold')).toBe(true)
    expect(t.globals.has('dice')).toBe(false)
    expect(t.locals.get('A')!.has('dice')).toBe(true)
  })
  it('节点参数进 locals 与 params', () => {
    const t = tbl('=== 店(category, discount) ===\n{category}\n-> END')
    expect(t.locals.get('店')!.has('category')).toBe(true)
    expect(t.params.map((p) => p.name).sort()).toEqual(['category', 'discount'])
  })
  it('标签进 labels 与 labelSet', () => {
    const t = tbl('=== A ===\n* (greet) [问候] "嗨"\n-> END')
    expect(t.labelSet.has('greet')).toBe(true)
    expect(t.labels[0]!.name).toBe('greet')
  })
  it('片段引用与语法错误记录在 fragments', () => {
    const t = tbl('=== A ===\n你有{gold}金币\n你有{bad +}\n-> END')
    const good = t.fragments.find((f) => f.references.includes('gold'))
    expect(good).toBeTruthy()
    const bad = t.fragments.find((f) => f.syntaxError !== null)
    expect(bad).toBeTruthy()
  })
  it('跨文件按文件名字典序合并 knots（首次入表）', () => {
    const t = tbl('=== A ===\n-> END', '=== A ===\n-> END')
    expect(t.knots.size).toBe(1) // 重名只入一次；dup 诊断由 checks/names 负责
  })
})
