import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from './index'

// docs/reference/kin_spec_draft.md §14 雾港之夜 main.kin
const FOG = [
  '// 雾港之夜 - main.kin',
  '~ let gold = 10',
  '~ let has_lantern = false',
  '~ let met_innkeeper = 0',
  '=== 雾港开场 ===',
  '@bg_show("harbor_fog.jpg")',
  '@bgm_play("ambient_fog.mp3")',
  '雾从港口涌上来，遮住了路灯。',
  '你站在码头边，{has_lantern ? "灯笼的光在雾中划出一圈昏黄" : "四周一片漆黑"}。',
  '* [走向客栈] -> 客栈',
  '* [沿码头继续走] -> 码头',
  '* {!has_lantern} [回家拿灯笼] -> 回家',
  '=== 客栈 ===',
  '@bg_show("tavern_interior.jpg")',
  '老板抬起头看着你。',
  '@if {met_innkeeper === 0}',
  '> 这是你第一次见他。',
  '@else',
  '> 你和他点了点头。',
  '~ met_innkeeper++',
  '"想要点什么？"',
  '* {gold >= 5} [买一杯酒（5 金币）]',
  '> ~ gold -= 5',
  '> 你接过酒杯，喝了一口。',
  '> -> 客栈',
  '* {gold >= 20 && !has_lantern} [买灯笼（20 金币）]',
  '> ~ gold -= 20',
  '> ~ has_lantern = true',
  '> 你接过灯笼，点亮了它。',
  '> -> 客栈',
  '* [离开客栈] -> 雾港开场',
  '=== 码头 ===',
  '雾里传来汽笛声。{ shuffle("远处", "更远处", "不知道哪里") }。',
  '-> END',
  '=== 回家 ===',
  '你回到家，拿了灯笼。',
  '~ has_lantern = true',
  '-> 雾港开场',
].join('\n')

describe('analyze 集成 —— 雾港之夜', () => {
  it('§14 完整示例零 error', () => {
    const r = analyze([parse(FOG, 'main.kin')])
    const errors = r.diagnostics.filter((d) => d.severity === 'error')
    expect(errors).toEqual([])
    expect(r.program).not.toBeNull()
  })
})

describe('analyze 集成 —— 多文件', () => {
  it('跨文件节点重名 + 全局变量重复各报一次', () => {
    const a = '~ let gold = 1\n=== 开场 ===\n-> END'
    const b = '~ let gold = 2\n=== 开场 ===\n-> END'
    const r = analyze([parse(a, 'a.kin'), parse(b, 'b.kin')])
    const codes = r.diagnostics.map((d) => d.code)
    expect(codes).toContain('duplicate-knot')
    expect(codes).toContain('duplicate-global')
    expect(r.program).toBeNull()
  })
})
