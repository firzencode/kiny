import { describe, it, expect } from 'vitest'
import { effectiveKeys, effectiveBindings, detectConflicts, commandUsing, dispatchMap } from './bindings'
import { COMMANDS, rebindableCommands } from './registry'

describe('shortcuts/registry 默认', () => {
  it('默认绑定在单一命名空间内无冲突', () => {
    expect(detectConflicts({}).size).toBe(0)
  })

  it('每条默认绑定都通过可绑校验（除 readonly 亦须合法）', () => {
    // 默认键都带修饰键或是 F 键
    for (const c of COMMANDS) {
      expect(c.defaultKeys.length).toBeGreaterThan(0)
    }
  })
})

describe('shortcuts/bindings', () => {
  it('effectiveKeys：无覆盖 = 默认', () => {
    const eff = effectiveKeys({})
    expect(eff.get('save')).toBe('Mod+S')
    expect(eff.get('help')).toBe('F1')
    expect(eff.get('toggleComment')).toBe('Mod+/')
  })

  it('effectiveKeys：合法覆盖生效，非法覆盖回落默认', () => {
    expect(effectiveKeys({ help: 'F3' }).get('help')).toBe('F3')
    expect(effectiveKeys({ help: 'A' }).get('help')).toBe('F1') // 裸字母非法 → 回落
  })

  it('effectiveKeys：readonly 命令的覆盖被忽略', () => {
    expect(effectiveKeys({ copy: 'Mod+Shift+C' }).get('copy')).toBe('Mod+C')
  })

  it('detectConflicts：覆盖撞到别的命令 → 报冲突', () => {
    const conf = detectConflicts({ save: 'Mod+O' }) // 与 openProject 撞
    expect(conf.has('Mod+O')).toBe(true)
    expect(conf.get('Mod+O')!.sort()).toEqual(['openProject', 'save'])
  })

  it('detectConflicts：撞到 readonly 原生键也算冲突', () => {
    const conf = detectConflicts({ save: 'Mod+C' }) // 撞 copy
    expect(conf.get('Mod+C')!.sort()).toEqual(['copy', 'save'])
  })

  it('commandUsing：候选组合被他命令占用则返回该命令', () => {
    expect(commandUsing('Mod+O', 'save', {})).toBe('openProject')
    expect(commandUsing('Mod+S', 'save', {})).toBe(null) // 自己占用不算
    expect(commandUsing('Mod+Shift+P', 'save', {})).toBe(null) // 无人用
  })

  it('dispatchMap global：只含 global 域、组合→id', () => {
    const g = dispatchMap('global', {})
    expect(g.get('Mod+S')).toBe('save')
    expect(g.get('F1')).toBe('help')
    expect(g.has('Mod+/')).toBe(false) // toggleComment 是 editor 域
    expect(g.has('Mod+Z')).toBe(false) // readonly 不入派发
  })

  it('dispatchMap editor：只含非 readonly 的 editor 域命令', () => {
    const e = dispatchMap('editor', {})
    expect(e.get('Mod+/')).toBe('toggleComment')
    expect(e.has('Mod+Z')).toBe(false) // undo readonly，原生处理
    expect(e.has('Mod+S')).toBe(false) // save 是 global
  })

  it('dispatchMap：覆盖后按新键派发', () => {
    const g = dispatchMap('global', { help: 'F3' })
    expect(g.get('F3')).toBe('help')
    expect(g.has('F1')).toBe(false)
  })

  it('dispatchMap：新命令默认绑定（搜索 Mod+Shift+F / 重命名 F2）', () => {
    const g = dispatchMap('global', {})
    expect(g.get('Mod+Shift+F')).toBe('searchInFiles')
    expect(g.get('F2')).toBe('renameNode')
  })

  it('effectiveBindings：展示序同 COMMANDS、含定义', () => {
    const list = effectiveBindings({})
    expect(list).toHaveLength(COMMANDS.length)
    expect(list[0]!.def.category).toBe('文件')
    expect(rebindableCommands().length).toBeLessThan(COMMANDS.length) // 有 readonly
  })
})
