import { describe, it, expect } from 'vitest'
import { validateProject, kinSourcesOf } from './validate'
import { STARTER_THEME_CSS } from '../files/gateway'

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

describe('kinSourcesOf（送校验的缓冲口径 · App 与动作层单点共用）', () => {
  it('只留 .kin，作品前端资源一律不送校验', () => {
    const got = kinSourcesOf([
      { path: 'main.kin', source: 'a' },
      { path: 'theme.css', source: STARTER_THEME_CSS },
      { path: 'data.json', source: '{}' },
      { path: 'README.md', source: '# x' },
      { path: 'assets/app.js', source: 'let a' },
      { path: 'notes.txt', source: 'x' },
      { path: 'page.html', source: '<p>' },
      { path: 'chapters/a.kin', source: 'b' },
    ])
    expect(got).toEqual([
      { path: 'main.kin', source: 'a' },
      { path: 'chapters/a.kin', source: 'b' },
    ])
  })

  it('与 isKinFile 同口径：`.kin` 区分大小写', () => {
    expect(kinSourcesOf([{ path: 'MAIN.KIN', source: 'a' }])).toEqual([])
  })

  it('只取 path / source，缓冲的其余字段（dirty 等）不带进校验输入', () => {
    // 真实调用点传的是 FileBuffer（带 dirty / savedSource），故经变量传入而非对象字面量
    const buf = { path: 'main.kin', source: 'a', savedSource: 'b', dirty: true }
    const got = kinSourcesOf([buf])
    expect(got).toEqual([{ path: 'main.kin', source: 'a' }])
  })

  it('作品 css 直接送进校验就是假诊断——本函数存在的理由', () => {
    // theme.css 脚手架含 `{`，engine parse 会当成未闭合插值；新建项目必带该文件。
    const raw = validateProject([{ path: 'theme.css', source: STARTER_THEME_CSS }])
    expect(raw.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    // 过滤后同一批缓冲干净：无诊断、program 非空由调用方的 .kin 决定
    const filtered = validateProject(kinSourcesOf([
      { path: 'main.kin', source: '=== 开场 ===\n正文。\n-> END' },
      { path: 'theme.css', source: STARTER_THEME_CSS },
    ]))
    expect(filtered.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    expect(filtered.program).not.toBeNull()
  })
})
