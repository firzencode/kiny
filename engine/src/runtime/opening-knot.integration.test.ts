import { describe, it, expect } from 'vitest'
import { storyFromEntry } from './_test-helpers'

const FOG = [
  '~ let gold = 10',
  '~ let met = 0',
  '-> 雾港开场', // 开场声明后显式进入具名场景
  '=== 雾港开场 ===',
  '@bg_show("harbor_fog.jpg")',
  '雾从港口涌上来。你有{gold}金币。',
  '-> END',
].join('\n')

describe('runtime 开场 knot 集成 —— §14 经入口解析贯通', () => {
  it('从开场 knot 起跑：声明落全局 → 跳进雾港开场 → 命令+插值正确', () => {
    const s = storyFromEntry(FOG)
    const trace: string[] = []
    while (s.canContinue) {
      const e = s.continue()
      trace.push(e.kind === 'text' ? `T ${e.text}` : `C ${e.name}(${e.args.map(String).join(',')})`)
    }
    expect(trace).toEqual(['C bg_show(harbor_fog.jpg)', 'T 雾从港口涌上来。你有10金币。'])
    expect(s.hasEnded).toBe(true)
  })
})
