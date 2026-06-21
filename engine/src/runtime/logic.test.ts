import { describe, it, expect } from 'vitest'
import { story, drain } from './_test-helpers'

describe('runtime 3b① 集成 —— 逻辑行 / 全局建表', () => {
  it('preamble 全局声明 + 节点内逻辑行执行不抛错，故事正常结束', () => {
    const s = story(['~ let n = 1', '=== A ===', '甲', '~ n = n + 1', '乙', '-> END'].join('\n'))
    const texts = drain(s).flatMap((e) => (e.kind === 'text' ? [e.text] : []))
    expect(texts).toEqual(['甲', '乙'])
    expect(s.hasEnded).toBe(true)
  })
  it('多 preamble 逻辑行按序建全局（function 声明可被后续逻辑行调用）', () => {
    const s = story(
      ['~ function inc(x){ return x + 1 }', '~ let n = inc(1)', '=== A ===', '文本', '-> END'].join(
        '\n',
      ),
    )
    const texts = drain(s).flatMap((e) => (e.kind === 'text' ? [e.text] : []))
    expect(texts).toEqual(['文本'])
    expect(s.hasEnded).toBe(true)
  })
})
