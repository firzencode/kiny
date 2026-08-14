import { describe, it, expect } from 'vitest'
import type { RichSpan } from '@kiny/engine'
import { parseCharacters } from './table'
import { applyCharactersToView } from './view'
import { initialState, type PlayState } from '../driver/storyDriver'

const table = parseCharacters('{"阿黎娅":{"color":"#7fb3d5"}}', { autoColor: true })
const line = (text: string): RichSpan[] => [{ text }]

function stateWith(over: Partial<PlayState>): PlayState {
  return { ...initialState, ...over }
}

describe('applyCharactersToView', () => {
  it('正文 / 选项 / 面板三处统一着色', () => {
    const s = stateWith({
      log: [{ kind: 'narration', spans: line('阿黎娅：台词') }],
      choices: [{ index: 0, spans: line('阿黎娅：跟你走') }],
      host: { ...initialState.host, panels: { left: line('阿黎娅：状态') } },
    })
    const v = applyCharactersToView(s, table)
    const first = (spans: RichSpan[]) => spans[0] as Extract<RichSpan, { text: string }>
    expect(first((v.log[0] as { spans: RichSpan[] }).spans).color).toBe('#7fb3d5')
    expect(first(v.choices[0]!.spans).color).toBe('#7fb3d5')
    expect(first(v.panels.left!).color).toBe('#7fb3d5')
  })

  it('空表原样返回同一批引用', () => {
    const s = stateWith({ log: [{ kind: 'narration', spans: line('阿黎娅：台词') }] })
    const v = applyCharactersToView(s, parseCharacters(null, { autoColor: true }))
    expect(v.log).toBe(s.log)
    expect(v.choices).toBe(s.choices)
    expect(v.panels).toBe(s.host.panels)
  })

  it('无标注的条目 / 无台词的面板保持引用不变', () => {
    const s = stateWith({
      log: [{ kind: 'narration', spans: line('这是旁白。') }, { kind: 'end' }],
      host: { ...initialState.host, panels: { left: line('生命 10') } },
    })
    const v = applyCharactersToView(s, table)
    expect(v.log[0]).toBe(s.log[0])
    expect(v.log[1]).toBe(s.log[1])
    expect(v.panels).toBe(s.host.panels)
  })

  it('非 narration 的 log 条目原样保留', () => {
    const s = stateWith({ log: [{ kind: 'image', src: 'a.png' }] })
    expect(applyCharactersToView(s, table).log[0]).toBe(s.log[0])
  })

  /**
   * 这条锁的是**正确性**而非性能：`RevealingLine` 拿 spans 数组的引用当「换行了没有」的判据，
   * 着色若每次都造新数组，正在揭示的那一行会被反复从头重放，读者看到台词一直重打。
   */
  it('同一 spans + 同一角色表反复调用 → 返回同一个着色后的数组', () => {
    const spans = line('阿黎娅：台词')
    const s = stateWith({ log: [{ kind: 'narration', spans }] })
    const a = applyCharactersToView(s, table)
    // state 变了（新的 log 数组）但那一行的 spans 引用没变——正是揭示中每次重渲染的情形。
    const b = applyCharactersToView(stateWith({ log: [{ kind: 'narration', spans }] }), table)
    expect((b.log[0] as { spans: RichSpan[] }).spans).toBe((a.log[0] as { spans: RichSpan[] }).spans)
  })

  it('换一张角色表 → 重新着色（editor 里改 characters.json 即时生效）', () => {
    const spans = line('阿黎娅：台词')
    const s = stateWith({ log: [{ kind: 'narration', spans }] })
    const a = applyCharactersToView(s, table)
    const other = parseCharacters('{"阿黎娅":{"color":"#ff0000"}}', { autoColor: true })
    const b = applyCharactersToView(s, other)
    const first = (v: typeof a) => (v.log[0] as { spans: RichSpan[] }).spans[0] as { color?: string }
    expect(first(a).color).toBe('#7fb3d5')
    expect(first(b).color).toBe('#ff0000')
  })
})
