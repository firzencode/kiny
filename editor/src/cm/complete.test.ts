import { describe, it, expect } from 'vitest'
import { matchCommand, matchDivert, matchVariable, currentKnotAt, COMMAND_NAMES } from './complete'

describe('matchCommand（@命令补全）', () => {
  it('@ 后空前缀：全部命令名、backup 0', () => {
    const m = matchCommand('@')!
    expect(m.options).toEqual(COMMAND_NAMES)
    expect(m.backup).toBe(0)
  })
  it('@bgm_ 部分前缀：backup = 前缀长', () => {
    expect(matchCommand('@bgm_')!.backup).toBe(4)
  })
  it('行内 @ 也触发（命令可在正文后）', () => {
    expect(matchCommand('正文 @bg')!.backup).toBe(2)
  })
  it('非 @ 上下文返回 null', () => {
    expect(matchCommand('普通文字')).toBeNull()
  })
})

describe('matchDivert（跳转目标补全）', () => {
  const knots = ['开场', '码头', '酒馆']
  const stitchesOf = (k: string) => (k === '码头' ? ['北岸', '南岸'] : [])

  it('-> 后空前缀：全部节点名', () => {
    const m = matchDivert('-> ', knots, stitchesOf)!
    expect(m.options).toEqual(knots)
    expect(m.backup).toBe(0)
  })
  it('-> 节点前缀：backup = 前缀长', () => {
    expect(matchDivert('-> 码', knots, stitchesOf)!.backup).toBe(1)
  })
  it('节点.子节点：补该节点的子节点、backup = 子节点前缀长', () => {
    const m = matchDivert('-> 码头.北', knots, stitchesOf)!
    expect(m.options).toEqual(['北岸', '南岸'])
    expect(m.backup).toBe(1)
  })
  it('选项内的 -> 也触发', () => {
    expect(matchDivert('* 去码头 -> 码头', knots, stitchesOf)!.options).toEqual(knots)
  })
  it('无 -> 返回 null', () => {
    expect(matchDivert('普通正文', knots, stitchesOf)).toBeNull()
  })
})

describe('matchVariable（变量补全）', () => {
  const vars = ['gold', 'name', 'flag']
  it('逻辑行 ~ 触发', () => {
    expect(matchVariable('~ gold = ', vars)).not.toBeNull()
  })
  it('未闭合插值 { 内触发', () => {
    const m = matchVariable('你有 {go', vars)!
    expect(m.options).toEqual(vars)
    expect(m.backup).toBe(2)
  })
  it('插值已闭合后不触发', () => {
    expect(matchVariable('你有 {gold} 金币 ', vars)).toBeNull()
  })
  it('普通正文不触发', () => {
    expect(matchVariable('普通正文 na', vars)).toBeNull()
  })
})

describe('currentKnotAt（光标所在节点）', () => {
  const src = ['=== 开场 ===', '正文', '=== 码头 ===', '正文2', '正文3'].join('\n')
  it('落在第 2 行 → 开场', () => {
    expect(currentKnotAt(src, 2)).toBe('开场')
  })
  it('落在第 5 行 → 码头', () => {
    expect(currentKnotAt(src, 5)).toBe('码头')
  })
  it('节点头之前（第 1 行之上不存在，preamble 返回 null）', () => {
    expect(currentKnotAt('~ let g = 0\n=== A ===', 1)).toBeNull()
  })
})
