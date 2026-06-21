import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { checkCommands } from './commands'

const run = (src: string) => checkCommands([parse(src, 'f.kin')])

describe('checkCommands', () => {
  it('内置命令零诊断', () => {
    expect(run('=== A ===\n@bg_show("x.jpg")\n-> END')).toEqual([])
  })
  it('@sfx 在白名单内：零诊断', () => {
    expect(run('=== A ===\n@sfx("door.mp3")\n-> END')).toEqual([])
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
})
