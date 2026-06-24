import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { analyze } from '../index'

/** 解析单文件并跑 analyze，返回诊断。 */
function diag(src: string) {
  return analyze([parse(src, 'main.kin')]).diagnostics
}

describe('checkRichText —— 内联富文本诊断', () => {
  it('合法富文本无诊断', () => {
    expect(diag('=== A ===\n<b>粗</b><color=#f00>红</color>\n-> END')).toEqual([])
  })

  it('未闭合标签 → rich-unclosed error', () => {
    const d = diag('=== A ===\n<b>粗到底\n-> END')
    expect(d).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'rich-unclosed', file: 'main.kin', line: 2 }),
    )
  })

  it('孤立闭标签 → rich-mismatch error', () => {
    const d = diag('=== A ===\n文字</i>\n-> END')
    expect(d).toContainEqual(expect.objectContaining({ code: 'rich-mismatch', severity: 'error', line: 2 }))
  })

  it('非法颜色值 → rich-bad-color error', () => {
    const d = diag('=== A ===\n<color=rgb(1,2,3)>x</color>\n-> END')
    expect(d).toContainEqual(expect.objectContaining({ code: 'rich-bad-color', severity: 'error', line: 2 }))
  })

  it('非法字号值 → rich-bad-size error', () => {
    const d = diag('=== A ===\n<size=0>x</size>\n-> END')
    expect(d).toContainEqual(expect.objectContaining({ code: 'rich-bad-size', severity: 'error', line: 2 }))
  })

  it('有富文本错误时 program 为 null（error 级阻断）', () => {
    const r = analyze([parse('=== A ===\n<b>未闭合\n-> END', 'main.kin')])
    expect(r.program).toBeNull()
  })
})
