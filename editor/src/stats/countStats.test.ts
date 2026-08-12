import { describe, expect, it } from 'vitest'
import { fileStats, projectStats, statsFor } from './countStats'

describe('fileStats', () => {
  it('统计正文字数：literal 文本段，剔除空白与 DSL 结构', () => {
    const src = [
      '=== 开场 ===',
      '你好，世界。',
      '* 选项一',
      '  选项一的正文。',
      '-> 下一章',
      '~ let x = 1',
      '@bgm_play("雨")',
      '= 下一章',
      '第二段 <b>加粗</b>。',
    ].join('\n')
    const s = fileStats(src, 'main.kin')
    // 正文：你好，世界。(6) + 选项一(3) + 选项一的正文。(7) + 第二段(3) + 加粗(2) + 。(1) = 22
    expect(s.textChars).toBe(22)
    expect(s.knots).toBe(1)
    expect(s.stitches).toBe(1)
    expect(s.choices).toBe(1)
    expect(s.commands).toBe(1)
    expect(s.diverts).toBe(1)
    expect(s.lines).toBe(9)
    expect(s.totalChars).toBeGreaterThan(s.textChars)
  })

  it('插值表达式与命令实参不计入正文', () => {
    const src = '=== 开场 ===\n你好，{name}。\n'
    const s = fileStats(src, 'main.kin')
    expect(s.textChars).toBe(4) // 你好，(3) + 。(1)
  })

  it('选项 before/inner/after 与标签都计入正文', () => {
    const src = ['=== 开场 ===', '+ [去海边] 走向沙滩', '  海风扑面。', ''].join('\n')
    const s = fileStats(src, 'main.kin')
    // 去海边(3) + 走向沙滩(4) + 海风扑面。(5) = 12
    expect(s.textChars).toBe(12)
    expect(s.choices).toBe(1)
  })

  it('解析失败回落启发式（不抛、有合理值）', () => {
    const src = '=== 未闭合\n正文若干。\n'
    const s = fileStats(src, 'broken.kin')
    expect(s.textChars).toBe(5) // 正文若干。(5)，节点头行被剔
    expect(s.totalChars).toBeGreaterThan(0)
  })

  it('条件分支正文计入正文', () => {
    const src = ['=== 开场 ===', '@if {x > 1}', '> 分支一正文。', '@else', '> 分支二正文。', ''].join('\n')
    const s = fileStats(src, 'main.kin')
    expect(s.textChars).toBe(12) // 分支一正文。(6) + 分支二正文。(6)
  })
})

describe('projectStats', () => {
  it('多文件求和并排序', () => {
    const p = projectStats([
      { path: 'b.kin', source: '=== 一 ===\n你好。' },
      { path: 'a.kin', source: '=== 二 ===\n世界。' },
    ])
    expect(p.files.map((f) => f.path)).toEqual(['a.kin', 'b.kin'])
    expect(p.textChars).toBe(6) // 你好。(3) + 世界。(3)
    expect(p.knots).toBe(2)
    expect(p.lines).toBe(4)
  })

  it('statsFor 返回当前文件与项目双口径', () => {
    const { file, project } = statsFor(
      [{ path: 'main.kin', source: '=== 开场 ===\n正文。' }],
      { path: 'main.kin', source: '=== 开场 ===\n正文。' },
    )
    expect(file?.textChars).toBe(3)
    expect(project.textChars).toBe(3)
  })
})
