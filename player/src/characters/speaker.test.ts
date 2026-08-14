import { describe, it, expect } from 'vitest'
import type { RichSpan } from '@kiny/engine'
import { parseCharacters } from './table'
import { matchSpeaker, colorizeLine } from './speaker'

const table = parseCharacters(
  '{"克里斯托弗":{},"阿黎娅":{"color":"#7fb3d5"},"林":{},"林然":{}}',
  { autoColor: true },
)
const t = (text: string, extra?: Partial<Extract<RichSpan, { text: string }>>): RichSpan => ({ text, ...extra })

describe('matchSpeaker', () => {
  it('认尖括号写法', () => {
    expect(matchSpeaker([t('<克里斯托弗> 我今天出门了。')], table)).toBe('克里斯托弗')
  })

  it('认冒号写法（全角与半角）', () => {
    expect(matchSpeaker([t('阿黎娅：外面在下雨。')], table)).toBe('阿黎娅')
    expect(matchSpeaker([t('阿黎娅:外面在下雨。')], table)).toBe('阿黎娅')
  })

  it('冒号写法取最长匹配', () => {
    expect(matchSpeaker([t('林然：走吧。')], table)).toBe('林然')
    expect(matchSpeaker([t('林：走吧。')], table)).toBe('林')
  })

  it('未声明的名字不触发', () => {
    expect(matchSpeaker([t('他说：走吧')], table)).toBeNull()
    expect(matchSpeaker([t('<随便什么> 文字')], table)).toBeNull()
    expect(matchSpeaker([t('时间：三点二十')], table)).toBeNull()
  })

  it('尖括号必须紧包名字', () => {
    expect(matchSpeaker([t('< 克里斯托弗> 台词')], table)).toBeNull()
    expect(matchSpeaker([t('<克里斯托弗 > 台词')], table)).toBeNull()
    expect(matchSpeaker([t('前缀<克里斯托弗> 台词')], table)).toBeNull()
  })

  it('空尖括号不触发', () => {
    expect(matchSpeaker([t('<> 台词')], table)).toBeNull()
  })

  it('标注只在行首生效', () => {
    expect(matchSpeaker([t('旁白。阿黎娅：台词')], table)).toBeNull()
  })

  it('首个 span 不是文本（break）/ 空行 → 不匹配', () => {
    expect(matchSpeaker([{ kind: 'break' }, t('阿黎娅：台词')], table)).toBeNull()
    expect(matchSpeaker([], table)).toBeNull()
  })

  it('空表恒不匹配', () => {
    expect(matchSpeaker([t('阿黎娅：台词')], parseCharacters(null, { autoColor: true }))).toBeNull()
  })
})

describe('colorizeLine', () => {
  it('整行所有文本 span 着该角色的颜色，标记原样保留', () => {
    const line = [t('<克里斯托弗> 我'), t('今天', { bold: true })]
    const out = colorizeLine(line, table)
    expect(out[0]).toEqual({ text: '<克里斯托弗> 我', color: table.get('克里斯托弗') })
    expect(out[1]).toEqual({ text: '今天', bold: true, color: table.get('克里斯托弗') })
  })

  it('作者显式写的 color 不被覆盖', () => {
    const out = colorizeLine([t('阿黎娅：'), t('红字', { color: '#ff0000' })], table)
    expect(out[1]).toEqual({ text: '红字', color: '#ff0000' })
  })

  it('break span 原样保留', () => {
    const out = colorizeLine([t('阿黎娅：一'), { kind: 'break' }, t('二')], table)
    expect(out[1]).toEqual({ kind: 'break' })
    expect(out[2]).toEqual({ text: '二', color: '#7fb3d5' })
  })

  it('无匹配时返回同一引用（不制造无谓重渲染）', () => {
    const line = [t('这是旁白。')]
    expect(colorizeLine(line, table)).toBe(line)
  })

  it('不改原数组', () => {
    const line = [t('阿黎娅：台词')]
    colorizeLine(line, table)
    expect(line[0]).toEqual({ text: '阿黎娅：台词' })
  })
})
