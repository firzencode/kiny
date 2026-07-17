import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { story, drain } from './_test-helpers'

describe('runtime 3a② —— 跳转', () => {
  it('跨 knot 跳转续接文本', () => {
    const s = story(['=== A ===', '甲', '-> B', '=== B ===', '乙', '-> END'].join('\n'))
    expect(drain(s).map((e) => (e.kind === 'text' ? plainText(e.spans) : '')).filter(Boolean)).toEqual(['甲', '乙'])
    expect(s.hasEnded).toBe(true)
  })
  it('跳转后本节点剩余内容不执行', () => {
    const s = story(['=== A ===', '甲', '-> B', '不该出现', '=== B ===', '-> END'].join('\n'))
    expect(drain(s).map((e) => (e.kind === 'text' ? plainText(e.spans) : ''))).toEqual(['甲'])
  })
  it('无 . 跳同级子节点', () => {
    const s = story(['=== A ===', '-> s', '= s', '丙', '-> END'].join('\n'))
    expect(drain(s).map((e) => (e.kind === 'text' ? plainText(e.spans) : ''))).toEqual(['丙'])
  })
  it('父.子 跨父跳子节点', () => {
    const s = story(['=== A ===', '-> B.s', '=== B ===', '-> END', '= s', '丁', '-> END'].join('\n'))
    expect(drain(s).map((e) => (e.kind === 'text' ? plainText(e.spans) : ''))).toEqual(['丁'])
  })
  it('带参 knot 内限定名跳自己的 stitch 保留参数', () => {
    const s = story(['=== A ===', '-> shop("灯笼")', '=== shop(item) ===', '-> shop.detail', '= detail', '详情:{item}', '-> END'].join('\n'))
    expect(drain(s).map((e) => (e.kind === 'text' ? plainText(e.spans) : '')).filter(Boolean)).toEqual(['详情:灯笼'])
  })
  it('knot 内限定名自跳保留局部变量', () => {
    const s = story(['=== A ===', '~ let n = 7', '-> A.s', '= s', '数{n}', '-> END'].join('\n'))
    expect(drain(s).map((e) => (e.kind === 'text' ? plainText(e.spans) : '')).filter(Boolean)).toEqual(['数7'])
  })
})
