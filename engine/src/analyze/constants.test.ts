import { describe, it, expect } from 'vitest'
import { BUILTINS, COMMAND_NAMES, JS_GLOBALS, ASCII_IDENT } from './constants'

describe('constants', () => {
  it('保留字 8 个、命令 6 个', () => {
    expect(BUILTINS.size).toBe(8)
    expect(COMMAND_NAMES.size).toBe(6)
    expect(JS_GLOBALS.has('Math')).toBe(true)
    expect(COMMAND_NAMES.has('bg_show')).toBe(true)
    expect(COMMAND_NAMES.has('sfx')).toBe(true)
  })
  it('ASCII_IDENT 接受英文标识符、拒绝中文', () => {
    expect(ASCII_IDENT.test('gold')).toBe(true)
    expect(ASCII_IDENT.test('player_hp')).toBe(true)
    expect(ASCII_IDENT.test('金币')).toBe(false)
    expect(ASCII_IDENT.test('1x')).toBe(false)
  })
})
