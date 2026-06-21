import { describe, it, expect } from 'vitest'
import { stripComments } from './comments'
import { parseStructure } from './structure'
import { foldFile } from './block'
import type { RawChoiceGroup, RawText } from './rawblock'

describe('pass0 → pass1 → pass2 端到端', () => {
  it('注释剥离后折叠出选项组与逻辑行，行号保真', () => {
    const src = [
      '=== 客栈 ===',
      '老板抬头。 // 旁白',
      '* {gold >= 5} [买酒]',
      '> ~ gold -= 5',
      '> 你喝了一口。',
      '* [离开] -> 雾港',
    ].join('\n')
    const file = foldFile(parseStructure(stripComments(src, 'f.kin'), 'f.kin'))
    const body = file.knots[0]!.body
    // 注释处经 pass 0 变空格，splitLevel trimStart 行首、行尾空格保留，故比对去尾空格
    expect(body[0]!.kind).toBe('text')
    expect((body[0] as RawText).raw.trimEnd()).toBe('老板抬头。')
    expect(body[0]!.line).toBe(2)
    const group = body[1] as RawChoiceGroup
    expect(group.kind).toBe('choiceGroup')
    expect(group.choices).toHaveLength(2)
    expect(group.choices[0]!.raw).toBe('{gold >= 5} [买酒]')
    expect(group.choices[0]!.body).toEqual([
      { kind: 'logicLine', code: 'gold -= 5', line: 4 },
      { kind: 'text', raw: '你喝了一口。', line: 5 },
    ])
    expect(group.choices[1]!.raw).toBe('[离开] -> 雾港')
  })
})
