import { describe, it, expect } from 'vitest'
import { story, drain } from './_test-helpers'
import { RuntimeError } from './types'

describe('runtime 3a —— 命令事件', () => {
  it('@bg_show("x") 产出 command 事件，args 经 evalExpr 求值', () => {
    const s = story('=== A ===\n@bg_show("x")\n-> END')
    expect(drain(s)).toEqual([{ kind: 'command', name: 'bg_show', args: ['x'] }])
  })

  it('命令 args 是表达式，求值后产出', () => {
    const src = ['~ let v = 0.5', '=== A ===', '@bgm_play("bgm", v + 0.3)', '-> END'].join('\n')
    expect(drain(story(src))).toEqual([{ kind: 'command', name: 'bgm_play', args: ['bgm', 0.8] }])
  })

  it('命令先于文本：命令在文本行之前产出', () => {
    const src = ['=== A ===', '@bg_show("h.jpg")', '雾涌上来。', '-> END'].join('\n')
    expect(drain(story(src))).toEqual([
      { kind: 'command', name: 'bg_show', args: ['h.jpg'] },
      { kind: 'text', text: '雾涌上来。' },
    ])
  })

  it('glue 文本后接命令：先 flush 文本（命令是硬边界）', () => {
    const src = ['=== A ===', '甲<>', '@bg_hide()', '乙', '-> END'].join('\n')
    expect(drain(story(src))).toEqual([
      { kind: 'text', text: '甲' },
      { kind: 'command', name: 'bg_hide', args: [] },
      { kind: 'text', text: '乙' },
    ])
  })

  it('@sfx("door.mp3") 产出 command 事件（一次性音效）', () => {
    const s = story('=== A ===\n@sfx("door.mp3")\n-> END')
    expect(drain(s)).toEqual([{ kind: 'command', name: 'sfx', args: ['door.mp3'] }])
  })

  it('连续命令各自产出', () => {
    const src = ['=== A ===', '@bg_hide()', '@bgm_stop()', '-> END'].join('\n')
    expect(drain(story(src))).toEqual([
      { kind: 'command', name: 'bg_hide', args: [] },
      { kind: 'command', name: 'bgm_stop', args: [] },
    ])
  })

  it('命令实参求值抛错时 RuntimeError 带 file + line 源定位', () => {
    const src = ['~ let o = null', '=== A ===', '@bg_show(o.x)', '-> END'].join('\n')
    let err: unknown
    try {
      drain(story(src))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(RuntimeError)
    expect((err as RuntimeError).file).toBe('main.kin')
    expect((err as RuntimeError).line).toBe(3)
  })
})
