import { describe, it, expect } from 'vitest'
import { validateProject } from './validate'

describe('validateProject 跨文件', () => {
  it('多文件干净 → 无 error 诊断 + program 非空', () => {
    const { diagnostics, program } = validateProject([
      { path: 'main.kin', source: '-> 开场\n=== 开场 ===\n正文。\n-> 末' },
      { path: 'end.kin', source: '=== 末 ===\n收尾。\n-> END' },
    ])
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    expect(program).not.toBeNull()
  })

  it('某文件语法错 → 该 file:line 一条 error + program=null', () => {
    const { diagnostics, program } = validateProject([
      { path: 'main.kin', source: '-> 开场\n=== 开场 ===\n-> 末' },
      { path: 'broken.kin', source: '=== 末 ===\n-> ' }, // 无目标 divert
    ])
    expect(program).toBeNull()
    const err = diagnostics.find((d) => d.severity === 'error')
    expect(err).toBeTruthy()
    expect(err!.file).toBe('broken.kin')
  })

  it('跨文件语义错（引用未定义节点）→ 带 file 的诊断', () => {
    const { diagnostics } = validateProject([
      { path: 'main.kin', source: '=== 开场 ===\n-> 不存在的节点\n' },
    ])
    expect(diagnostics.some((d) => d.severity === 'error' && d.file === 'main.kin')).toBe(true)
  })

  it('子目录文件的诊断 file 用相对路径', () => {
    const { diagnostics } = validateProject([{ path: 'chapters/a.kin', source: '=== x ===\n-> 不存在\n' }])
    expect(diagnostics[0].file).toBe('chapters/a.kin')
  })
})
