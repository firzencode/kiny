import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { story, play, texts } from './_test-helpers'

describe('runtime 3h —— 带参 + turns', () => {
  it('带参节点绑定实参为局部变量', () => {
    const src = ['=== A ===', '-> 店("灯笼", 0.8)', '=== 店(cat, disc) ===', '卖{cat}，{disc*100}折', '-> END'].join('\n')
    expect(texts(story(src))).toEqual(['卖灯笼，80折'])
  })
  it('选项行尾带参跳转绑定实参', () => {
    const src = ['=== A ===', '* [买] -> 店("灯笼", 0.8)', '=== 店(cat, disc) ===', '卖{cat}，{disc*100}折', '-> END'].join('\n')
    const r = play(story(src), [0])
    expect(r.texts).toContain('卖灯笼，80折')
  })
  it('turns_since 跨回合递增', () => {
    const src = ['=== A ===', '* [去B] -> B', '=== B ===', '* [去C] -> C', '=== C ===', '距A{turns_since("A")}', '-> END'].join('\n')
    const s = story(src); const out: string[] = []
    for(;;){ while(s.canContinue){const e=s.continue(); if(e.kind==='text')out.push(plainText(e.spans))} if(s.currentChoices.length>0)s.choose(0); else break }
    expect(out).toContain('距A2')  // 进A turns=0 visitedAt{A:0}；去B turns=1；去C turns=2；C 内 turns_since(A)=2-0=2
  })
  it('turns_since 未访问为 -1，访问后递增', () => {
    const src = ['=== A ===', '差{turns_since("B")}', '* [去B] -> B', '=== B ===', '差{turns_since("B")}', '-> END'].join('\n')
    const s = story(src); const out: string[] = []
    for(;;){ while(s.canContinue){const e=s.continue(); if(e.kind==='text')out.push(plainText(e.spans))} if(s.currentChoices.length>0)s.choose(0); else break }
    expect(out[0]).toBe('差-1')   // 进 A 时 B 未访问
    expect(out[1]).toBe('差0')    // 刚进 B（同回合）
  })
})
