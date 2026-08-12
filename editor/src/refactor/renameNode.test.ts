import { describe, expect, it } from 'vitest'
import { applyRename, computeRenamePlan, validateNewName } from './renameNode'

const SRC_MAIN = [
  '=== 开场 ===',
  '雾港的夜晚。',
  '-> 码头',
  '-> 码头.栈桥',
  '* 去集市',
  '> -> 集市',
  '=== 码头 ===',
  '栈桥。',
  '= 栈桥',
  '黄昏。',
  '=== 集市(p) ===',
  '热闹。',
  '-> 码头',
].join('\n')

describe('validateNewName', () => {
  it('拒绝空名 / 空白 / 点 / 括号 / 保留字 / 同名', () => {
    expect(validateNewName('', 'a')).toMatch(/空/)
    expect(validateNewName('a b', 'a')).toMatch(/空格/)
    expect(validateNewName('a.b', 'a')).toMatch(/\./)
    expect(validateNewName('a(b', 'a')).toMatch(/括号/)
    expect(validateNewName('END', 'a')).toMatch(/保留/)
    expect(validateNewName('a', 'a')).toMatch(/相同/)
    expect(validateNewName('新名字', 'a')).toBeNull()
  })
})

describe('computeRenamePlan', () => {
  const buffers = [
    { path: 'main.kin', source: SRC_MAIN },
    { path: 'other.kin', source: '=== 支线 ===\n-> 码头\n-> 集市(p)\n' },
  ]

  it('重命名节点：定义 + 无前缀 + 限定名 + 跨文件引用全部更新，实参保留', () => {
    const plan = computeRenamePlan(buffers, { path: 'main.kin', name: '码头' }, '港口')
    expect(plan.referenceCount).toBe(4) // main: -> 码头, -> 码头.栈桥, -> 码头(集市内); other: -> 码头
    expect(plan.affectedFiles.sort()).toEqual(['main.kin', 'other.kin'])
    const applied = applyRename(buffers, plan)
    const main = applied.find((x) => x.path === 'main.kin')!.source
    expect(main).toContain('=== 港口 ===') // 定义更新
    expect(main).toContain('-> 港口') // 裸跳转
    expect(main).toContain('-> 港口.栈桥') // 限定名父段更新、子段保留
    expect(main).not.toContain('=== 码头 ===')
    const other = applied.find((x) => x.path === 'other.kin')!.source
    expect(other).toContain('-> 港口')
    expect(other).toContain('-> 集市(p)') // 无关引用原样
  })

  it('带参节点的跳转实参保留', () => {
    const src = '=== 集市(p) ===\n热闹。\n'
    const plan = computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '集市' }, '市场')
    const applied = applyRename([{ path: 'main.kin', source: src }], plan)
    expect(applied[0]!.source).toContain('=== 市场(p) ===')
  })

  it('无前缀消歧：全局节点优先于宿主子节点（与 analyze 一致）', () => {
    // 全局有 knot「引线」，knot「甲」内也有 stitch「引线」：甲内的 -> 引线 指向全局 knot，重命名全局 knot 时须更新
    const src = [
      '=== 引线 ===',
      '线头。',
      '=== 甲 ===',
      '-> 引线',
      '= 引线',
      '分叉。',
      '-> 引线',
    ].join('\n')
    const plan = computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '引线' }, '主线')
    expect(plan.referenceCount).toBe(2) // 甲正文内 1 处 + 子节点内 1 处；定义头 1 处不计
    const applied = applyRename([{ path: 'main.kin', source: src }], plan)
    expect(applied[0]!.source).toContain('=== 主线 ===')
    expect(applied[0]!.source).toContain('= 引线') // stitch 定义不被动
    expect(applied[0]!.source.match(/-> 主线/g)).toHaveLength(2)
  })

  it('重命名 knot 不误伤其它节点的同名子节点限定引用', () => {
    // knot「乙」有子节点「集市」；`-> 乙.集市` 是限定引用，父段是乙，重命名全局 knot「集市」不该动它
    const src = [
      '=== 集市 ===',
      '热闹。',
      '=== 乙 ===',
      '= 集市',
      '分叉。',
      '-> 乙.集市',
    ].join('\n')
    const plan = computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '集市' }, '市场')
    expect(plan.referenceCount).toBe(0)
  })

  it('新名与全局节点重名 / 与本节点子节点重名 → 报错', () => {
    const src = ['=== 甲 ===', '-> 乙', '= 乙', 'x', '=== 乙 ===', 'y', ''].join('\n')
    expect(() =>
      computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '甲' }, '乙'),
    ).toThrow(/已存在/)
    expect(() =>
      computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '乙' }, '乙'),
    ).toThrow(/相同/)
    // 乙 有自己的子节点「乙」？不成立——用另一例：节点「丙」含子节点「丁」，重命名丙为丁
    const src2 = ['=== 丙 ===', '= 丁', 'x', ''].join('\n')
    expect(() =>
      computeRenamePlan([{ path: 'main.kin', source: src2 }], { path: 'main.kin', name: '丙' }, '丁'),
    ).toThrow(/子节点/)
  })

  it('动态跳转 -> {表达式} 不处理，其余照常', () => {
    const src = ['=== 甲 ===', '-> {目标}', '=== 乙 ===', 'x', ''].join('\n')
    const plan = computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '甲' }, '丙')
    expect(plan.referenceCount).toBe(0)
    const applied = applyRename([{ path: 'main.kin', source: src }], plan)
    expect(applied[0]!.source).toContain('-> {目标}')
  })

  it('目标不存在 / 文件解析失败 → 报错', () => {
    expect(() =>
      computeRenamePlan([{ path: 'main.kin', source: SRC_MAIN }], { path: 'main.kin', name: '不存在' }, '新'),
    ).toThrow(/不存在/)
    expect(() =>
      computeRenamePlan([{ path: 'broken.kin', source: '=== 未闭合' }], { path: 'broken.kin', name: '未闭合' }, '新'),
    ).toThrow(/无法解析/)
  })

  it('新名与其它节点子节点重名 → 给出警告而非报错', () => {
    const src = ['=== 甲 ===', 'x', '=== 乙 ===', '= 丙', 'y', ''].join('\n')
    const plan = computeRenamePlan([{ path: 'main.kin', source: src }], { path: 'main.kin', name: '甲' }, '丙')
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]!.kind).toBe('stitch-shadow')
  })
})
