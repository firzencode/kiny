import { describe, it, expect } from 'vitest'
import { story, texts } from './_test-helpers'

describe('runtime 3g —— @if', () => {
  it('@if 真分支 + 汇合', () => {
    const src = ['~ let m = 0', '=== A ===', '@if {m === 0}', '> 第一次', '@else', '> 又见', '想要点什么？', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['第一次', '想要点什么？'])
  })
  it('@elif 链', () => {
    const src = ['~ let m = 2', '=== A ===', '@if {m === 0}', '> 零', '@elif {m < 3}', '> 少', '@else', '> 多', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['少'])
  })
  it('无命中无 else 跳过', () => {
    const src = ['~ let m = 9', '=== A ===', '@if {m === 0}', '> 零', '后续', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['后续'])
  })
})
