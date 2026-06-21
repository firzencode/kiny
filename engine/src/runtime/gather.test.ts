import { describe, it, expect } from 'vitest'
import { story, play } from './_test-helpers'

describe('runtime 3d —— 分支体 + 汇合', () => {
  it('选项体执行完汇合到选项组之后', () => {
    const src = ['=== A ===', '问', '* [甲]', '> 选了甲', '* [乙]', '> 选了乙', '继续前行', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.texts).toEqual(['问', '选了甲', '继续前行'])
  })
  it('体内显式跳走不汇合', () => {
    const src = ['=== A ===', '* [走]', '> 转身', '> -> 外', '汇合点不该到', '=== 外 ===', '到外面', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.texts).toEqual(['转身', '到外面'])
    expect(r.texts).not.toContain('汇合点不该到')
  })
  it('嵌套选项逐层汇合', () => {
    const src = ['=== A ===', '* [外]', '> 进外', '> * [内]', '> > 进内', '> 外续', '后续', '-> END'].join('\n')
    const r = play(story(src), [0, 0])
    expect(r.texts).toEqual(['进外', '进内', '外续', '后续'])
  })
})
