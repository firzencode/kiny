import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { checkMissingChoiceMarker } from './missing-choice-marker'

function check(src: string) {
  return checkMissingChoiceMarker([parse(src, 'main.kin')])
}

describe('checkMissingChoiceMarker', () => {
  it('方括号整行 + 紧跟无条件 divert → warning', () => {
    const src = ['=== 开场 ===', '正文。', '[向右走] -> 右', '=== 右 ===', '到了。', '-> END'].join('\n')
    const out = check(src)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      severity: 'warning',
      code: 'missing-choice-marker',
      file: 'main.kin',
    })
    expect(out[0]!.message).toContain('[向右走]')
  })

  it('正常 * / + 选项不误报', () => {
    const star = ['=== 开场 ===', '* [向右走] -> 右', '=== 右 ===', '。', '-> END'].join('\n')
    const plus = ['=== 开场 ===', '+ [向右走] -> 右', '=== 右 ===', '。', '-> END'].join('\n')
    expect(check(star)).toHaveLength(0)
    expect(check(plus)).toHaveLength(0)
  })

  it('合法方括号正文（非整行 / 后不跟 divert）不误报', () => {
    // 方括号后还有文字 → 纯文本非「整行方括号」
    const note = ['=== 开场 ===', '[注] 这是脚注', '-> END'].join('\n')
    // 方括号整行但后面跟的是正文行（非 divert）
    const noDivert = ['=== 开场 ===', '[向右走]', '继续走着。', '-> END'].join('\n')
    expect(check(note)).toHaveLength(0)
    expect(check(noDivert)).toHaveLength(0)
  })

  it('[完] -> END / [全文完] -> DONE 不误报（合法收尾字幕）', () => {
    const end = ['=== 开场 ===', '[完] -> END'].join('\n')
    const done = ['=== 开场 ===', '[全文完] -> DONE'].join('\n')
    expect(check(end)).toHaveLength(0)
    expect(check(done)).toHaveLength(0)
  })

  it('选项体内的漏标记也能检出（递归路径）', () => {
    // > 前缀把内容放进选项体；[向右走] -> 右 落在 * [进门] 的 body 里
    const src = ['=== 开场 ===', '* [进门]', '> [向右走] -> 右', '=== 右 ===', '到了。', '-> END'].join('\n')
    const out = check(src)
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('[向右走]')
  })
})
