import { describe, it, expect } from 'vitest'
import { normalize, parse, format, toCmKey, isBindable } from './keys'

describe('shortcuts/keys', () => {
  it('normalize：修饰键 + 主键，固定序，字母大写', () => {
    expect(normalize({ key: 's', ctrlKey: true })).toBe('Mod+S')
    expect(normalize({ key: 's', metaKey: true })).toBe('Mod+S') // Cmd = Mod
    expect(normalize({ key: 's', ctrlKey: true, altKey: true })).toBe('Mod+Alt+S')
    expect(normalize({ key: 'N', ctrlKey: true, shiftKey: true })).toBe('Mod+Shift+N')
    expect(normalize({ key: '/', ctrlKey: true })).toBe('Mod+/')
    expect(normalize({ key: 'F1' })).toBe('F1')
  })

  it('normalize：+ 归一到 =，纯修饰键返回空串', () => {
    expect(normalize({ key: '+', ctrlKey: true })).toBe('Mod+=')
    expect(normalize({ key: '=', ctrlKey: true })).toBe('Mod+=')
    expect(normalize({ key: 'Control', ctrlKey: true })).toBe('')
    expect(normalize({ key: 'Shift', shiftKey: true })).toBe('')
  })

  it('normalize：Ctrl+Shift+= / Ctrl++ 等价于 Ctrl+=（放大字号，忽略 Shift）', () => {
    // 主行「Ctrl +」= Shift+= → 归一丢弃 Shift，与 Ctrl+= 同一组合
    expect(normalize({ key: '+', ctrlKey: true, shiftKey: true })).toBe('Mod+=')
    expect(normalize({ key: '=', ctrlKey: true, shiftKey: true })).toBe('Mod+Shift+=') // 真 Shift+= 才带 Shift
  })

  it('parse：拆修饰键与主键', () => {
    expect(parse('Mod+Alt+S')).toEqual({ mod: true, alt: true, shift: false, key: 'S' })
    expect(parse('F1')).toEqual({ mod: false, alt: false, shift: false, key: 'F1' })
    expect(parse('Mod+/')).toEqual({ mod: true, alt: false, shift: false, key: '/' })
  })

  it('format：Windows 用 Ctrl+，Mac 用 ⌘ 无分隔', () => {
    expect(format('Mod+S', false)).toBe('Ctrl+S')
    expect(format('Mod+Alt+S', false)).toBe('Ctrl+Alt+S')
    expect(format('Mod+S', true)).toBe('⌘S')
    expect(format('Mod+Shift+N', true)).toBe('⌘⇧N')
    expect(format('F1', false)).toBe('F1')
  })

  it('normalize↔parse 往返一致', () => {
    const e = { key: 'k', ctrlKey: true, shiftKey: true }
    const canon = normalize(e)
    const c = parse(canon)
    expect(c).toEqual({ mod: true, alt: false, shift: true, key: 'K' })
  })

  it('toCmKey：+ 换成 -', () => {
    expect(toCmKey('Mod+/')).toBe('Mod-/')
    expect(toCmKey('Mod+Shift+S')).toBe('Mod-Shift-S')
    expect(toCmKey('F1')).toBe('F1')
  })

  it('isBindable：须带修饰键，F1–F12 例外，Shift 不充分', () => {
    expect(isBindable('Mod+S').ok).toBe(true)
    expect(isBindable('Alt+X').ok).toBe(true)
    expect(isBindable('F1').ok).toBe(true)
    expect(isBindable('F12').ok).toBe(true)
    expect(isBindable('A').ok).toBe(false) // 裸字母
    expect(isBindable('Shift+A').ok).toBe(false) // 仅 Shift 不算
    expect(isBindable('F13').ok).toBe(false) // 不存在的功能键当普通裸键
  })
})
