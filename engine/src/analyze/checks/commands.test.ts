import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { analyze } from '../index'
import { checkCommands } from './commands'

const run = (src: string) => checkCommands([parse(src, 'f.kin')])

describe('checkCommands', () => {
  it('内置命令零诊断', () => {
    expect(run('=== A ===\n@bg_show("x.jpg")\n-> END')).toEqual([])
  })
  it('@sfx 在白名单内：零诊断', () => {
    expect(run('=== A ===\n@sfx("door.mp3")\n-> END')).toEqual([])
  })
  it('@clear 在白名单内：零诊断', () => {
    expect(run('=== A ===\n@clear()\n-> END')).toEqual([])
  })
  it('T033 推进 / 打字机命令在白名单内：零诊断', () => {
    expect(run('=== A ===\n@step_mode("line")\n@text_speed(30)\n@text_fade(120)\n-> END')).toEqual([])
  })
  it('未知命令报 unknown-command', () => {
    const ds = run('=== A ===\n@teleport("x")\n-> END')
    expect(ds).toHaveLength(1)
    expect(ds[0]!.code).toBe('unknown-command')
    expect(ds[0]!.line).toBe(2)
  })
  it('choice 体内的未知命令被检出', () => {
    const src = ['=== A ===', '* [opt]', '> @teleport("x")', '> -> END'].join('\n')
    const ds = run(src)
    expect(ds).toHaveLength(1)
    expect(ds[0]!.code).toBe('unknown-command')
  })
  it('conditional 分支体内的未知命令被检出', () => {
    const src = ['=== A ===', '@if {x}', '> @teleport("y")', '-> END'].join('\n')
    const ds = run(src)
    expect(ds).toHaveLength(1)
    expect(ds[0]!.code).toBe('unknown-command')
  })

  describe('@input 形态特判', () => {
    it('@input(var) / @input(var, "hint") 形态合法：checkCommands 零诊断', () => {
      expect(run('=== A ===\n@input(name)\n-> END')).toEqual([])
      expect(run('=== A ===\n@input(name, "请输入名字")\n-> END')).toEqual([])
    })
    it('@input() 零参 → input-arity', () => {
      const ds = run('=== A ===\n@input()\n-> END')
      expect(ds).toHaveLength(1)
      expect(ds[0]!.code).toBe('input-arity')
      expect(ds[0]!.line).toBe(2)
    })
    it('@input(a, b, c) 三参 → input-arity', () => {
      const ds = run('=== A ===\n@input(a, b, c)\n-> END')
      expect(ds.some((d) => d.code === 'input-arity')).toBe(true)
    })
    it('@input("字面量") 首参非标识符 → input-target', () => {
      const ds = run('=== A ===\n@input("x")\n-> END')
      expect(ds.some((d) => d.code === 'input-target')).toBe(true)
    })
    it('@input(a.b) 首参非裸标识符 → input-target', () => {
      const ds = run('=== A ===\n@input(a.b)\n-> END')
      expect(ds.some((d) => d.code === 'input-target')).toBe(true)
    })
  })

  describe('@input 集成（经 analyze：变量存在性由 checkVariables 覆盖）', () => {
    const diags = (src: string) => analyze([parse(src, 'f.kin')]).diagnostics
    it('已声明变量 → 无 error', () => {
      const src = ['~ let name = "旅人"', '=== A ===', '@input(name, "请输入名字")', '你好，{name}。', '-> END'].join('\n')
      expect(diags(src).filter((d) => d.severity === 'error')).toEqual([])
    })
    it('未声明变量 → undeclared-var（不留到运行时）', () => {
      const src = ['=== A ===', '@input(ghost)', '-> END'].join('\n')
      expect(diags(src).some((d) => d.code === 'undeclared-var')).toBe(true)
    })
    it('@input 不再报 unknown-command', () => {
      const src = ['~ let x = ""', '=== A ===', '@input(x)', '-> END'].join('\n')
      expect(diags(src).some((d) => d.code === 'unknown-command')).toBe(false)
    })
  })
})
