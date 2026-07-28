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

  describe('@sleep 形态特判', () => {
    it('@sleep(1500) 合法：零诊断', () => {
      expect(run('=== A ===\n@sleep(1500)\n-> END')).toEqual([])
    })
    it('@sleep(0) / 小数合法（0 = 不停顿）', () => {
      expect(run('=== A ===\n@sleep(0)\n@sleep(1.5)\n-> END')).toEqual([])
    })
    it('@sleep() 零参 → sleep-arity', () => {
      const ds = run('=== A ===\n@sleep()\n-> END')
      expect(ds).toHaveLength(1)
      expect(ds[0]!.code).toBe('sleep-arity')
      expect(ds[0]!.line).toBe(2)
    })
    it('@sleep(1, 2) 多参 → sleep-arity', () => {
      expect(run('=== A ===\n@sleep(1, 2)\n-> END').map((d) => d.code)).toContain('sleep-arity')
    })
    it('负数字面量 → sleep-duration', () => {
      const ds = run('=== A ===\n@sleep(-1)\n-> END')
      expect(ds).toHaveLength(1)
      expect(ds[0]!.code).toBe('sleep-duration')
    })
    it('非数字字面量（字符串 / 布尔 / null）→ sleep-duration', () => {
      for (const arg of ['"500"', 'true', 'null']) {
        expect(run(`=== A ===\n@sleep(${arg})\n-> END`).map((d) => d.code), arg).toContain('sleep-duration')
      }
    })
    it('变量 / 表达式参不静态拦截（运行期由 player 兜底）', () => {
      expect(run('=== A ===\n@sleep(ms)\n-> END')).toEqual([])
      expect(run('=== A ===\n@sleep(base * 2)\n-> END')).toEqual([])
    })
  })

  describe('@panel 形态特判', () => {
    it('四个合法槽位 + 模板：零诊断', () => {
      expect(run('=== A ===\n@panel("left", "HP: {hp}")\n@panel("right", "菜单")\n@panel("bottom", "第 {c} 章")\n@panel("after", "")\n-> END')).toEqual([])
    })
    it('模板可为表达式（运行期求值）', () => {
      expect(run('=== A ===\n@panel("left", tpl)\n-> END')).toEqual([])
      expect(run('=== A ===\n@panel("left", "HP: " + hp)\n-> END')).toEqual([])
    })
    it('arity ≠ 2 → panel-arity', () => {
      expect(run('=== A ===\n@panel("left")\n-> END').map((d) => d.code)).toContain('panel-arity')
      expect(run('=== A ===\n@panel("left", "a", "b")\n-> END').map((d) => d.code)).toContain('panel-arity')
    })
    it('未知槽位 → panel-slot', () => {
      const ds = run('=== A ===\n@panel("top", "x")\n-> END')
      expect(ds).toHaveLength(1)
      expect(ds[0]!.code).toBe('panel-slot')
      expect(ds[0]!.message).toContain('top')
    })
    it('槽位非字符串字面量（变量 / 表达式）→ panel-slot（引擎登记时就要知道是哪个槽）', () => {
      expect(run('=== A ===\n@panel(slot, "x")\n-> END').map((d) => d.code)).toContain('panel-slot')
      expect(run('=== A ===\n@panel("si" + "de", "x")\n-> END').map((d) => d.code)).toContain('panel-slot')
    })
    it('模板写成数字 / 布尔字面量 → panel-template', () => {
      expect(run('=== A ===\n@panel("left", 42)\n-> END').map((d) => d.code)).toContain('panel-template')
      expect(run('=== A ===\n@panel("left", true)\n-> END').map((d) => d.code)).toContain('panel-template')
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
    // A7：@input 目标为内置函数名会破坏该 Story 的内置函数。
    it('@input 目标为内置函数名报 input-target-builtin', () => {
      expect(run('=== A ===\n@input(random)\n-> END').map((d) => d.code)).toContain('input-target-builtin')
    })
    it('@input 目标为普通变量名不报 input-target-builtin', () => {
      expect(run('=== A ===\n@input(name)\n-> END').map((d) => d.code)).not.toContain('input-target-builtin')
    })
  })
})
