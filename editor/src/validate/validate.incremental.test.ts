import { describe, it, expect, vi } from 'vitest'
import { parse as realParse, analyze as realAnalyze } from '@kiny/engine'
import { createIncrementalValidator, validateProject } from './validate'

const MAIN = { path: 'main.kin', source: '-> 开场\n=== 开场 ===\n正文。\n-> 末' }
const END = { path: 'end.kin', source: '=== 末 ===\n收尾。\n-> END' }
const clean = () => [{ ...MAIN }, { ...END }]
const BROKEN = { path: 'broken.kin', source: '=== 末 ===\n-> ' } // 无目标 divert → parse 报错

describe('createIncrementalValidator 缓存', () => {
  it('同输入连续两次 → 第二次不重 parse，analyze 仍跑全量', () => {
    const parse = vi.fn(realParse)
    const analyze = vi.fn(realAnalyze)
    const v = createIncrementalValidator({ parse, analyze })
    v.validate(clean())
    expect(parse).toHaveBeenCalledTimes(2)
    parse.mockClear()
    analyze.mockClear()
    v.validate(clean())
    expect(parse).toHaveBeenCalledTimes(0)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('改一个文件 → 仅该文件重 parse', () => {
    const parse = vi.fn(realParse)
    const v = createIncrementalValidator({ parse })
    v.validate(clean())
    parse.mockClear()
    const changedSrc = '=== 末 ===\n改了。\n-> END'
    v.validate([{ ...MAIN }, { path: 'end.kin', source: changedSrc }])
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledWith(changedSrc, 'end.kin')
  })

  it('新增文件 → 仅新文件 parse', () => {
    const parse = vi.fn(realParse)
    const v = createIncrementalValidator({ parse })
    v.validate([{ ...MAIN }])
    parse.mockClear()
    v.validate(clean())
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledWith(END.source, 'end.kin')
  })

  it('文件删除后再以含它的旧集合 validate → 被逐出后重 parse', () => {
    const parse = vi.fn(realParse)
    const v = createIncrementalValidator({ parse })
    v.validate(clean()) // 缓存 main + end
    v.validate([{ ...MAIN }]) // end 被逐出
    parse.mockClear()
    v.validate(clean()) // end 不命中（已逐出）→ 重 parse；main 命中
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledWith(END.source, 'end.kin')
  })

  it('parse 失败的文件 source 不变 → 不重复 parse，仍 program=null 且报该文件', () => {
    const parse = vi.fn(realParse)
    const v = createIncrementalValidator({ parse })
    const r1 = v.validate([{ ...BROKEN }])
    expect(r1.program).toBeNull()
    expect(parse).toHaveBeenCalledTimes(1)
    parse.mockClear()
    const r2 = v.validate([{ ...BROKEN }])
    expect(parse).toHaveBeenCalledTimes(0)
    expect(r2.program).toBeNull()
    expect(r2.diagnostics.some((d) => d.file === 'broken.kin')).toBe(true)
  })

  it('与全量 validateProject 输出深相等（多步改动序列）', () => {
    const v = createIncrementalValidator()
    const seqs = [
      clean(),
      [{ ...MAIN }, { path: 'end.kin', source: '=== 末 ===\n改。\n-> END' }],
      [...clean(), { ...BROKEN }],
      clean(),
    ]
    for (const files of seqs) {
      expect(v.validate(files)).toEqual(validateProject(files))
    }
  })
})
