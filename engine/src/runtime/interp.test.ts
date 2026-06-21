import { describe, it, expect } from 'vitest'
import { story, texts } from './_test-helpers'
import { RuntimeError } from './types'

describe('runtime 3b② —— 插值 + 节点局部作用域', () => {
  it('全局变量插值', () => {
    const s = story('~ let gold = 10\n=== A ===\n你有{gold}金币\n-> END')
    expect(texts(s)).toEqual(['你有10金币'])
  })
  it('三元插值', () => {
    const s = story('~ let hp = 30\n=== A ===\n状态：{hp > 50 ? "好" : "弱"}\n-> END')
    expect(texts(s)).toEqual(['状态：弱'])
  })
  it('节点局部变量只在本节点可见、跳走即失效', () => {
    const s = story(['~ let g = 0', '=== A ===', '~ let dice = 6', '点数{dice}', '-> B', '=== B ===', '~ g = 1', '完{g}', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['点数6', '完1'])
  })
  it('undefined/null 插值为空串', () => {
    const s = story('~ let x = null\n=== A ===\n[{x}]\n-> END')
    expect(texts(s)).toEqual(['[]'])
  })
  it('插值求值抛错时 RuntimeError 带 file + line 源定位', () => {
    const s = story('~ let o = null\n=== A ===\n值{o.x}\n-> END')
    let err: unknown
    try {
      texts(s)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(RuntimeError)
    expect((err as RuntimeError).file).toBe('main.kin')
    expect((err as RuntimeError).line).toBe(3)
  })
})
