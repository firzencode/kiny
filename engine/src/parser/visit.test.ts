import { describe, it, expect } from 'vitest'
import { visitBlockTree } from './visit'
import type { Choice, ChoiceGroup, Conditional, ContentBlock, TextLine } from './ast'

const text = (line: number): TextLine => ({ kind: 'text', segments: [], glue: false, line })
const choice = (label: string, body: ContentBlock): Choice => ({
  sticky: false, fallback: false, condition: null, label,
  before: [], inner: null, after: [], resultDivert: null, body, line: 0,
})
const group = (...choices: Choice[]): ChoiceGroup => ({ kind: 'choiceGroup', choices, line: 0 })
const cond = (...bodies: ContentBlock[]): Conditional => ({
  kind: 'conditional', branches: bodies.map((body) => ({ condition: null, body, line: 0 })), line: 0,
})

describe('visitBlockTree —— 顺序契约', () => {
  it('choice 触发序为深度优先、逐 choice 交错下钻（= enumerateChoices 枚举序）', () => {
    // c0 的 body 内还有 c0a；c0 先入、再下钻其 body、然后才 c1。
    const root: ContentBlock = [
      text(1),
      group(
        choice('c0', [group(choice('c0a', []))]),
        choice('c1', []),
      ),
    ]
    const seen: string[] = []
    visitBlockTree<null>(root, null, { choice: (c) => (seen.push(c.label!), null) })
    expect(seen).toEqual(['c0', 'c0a', 'c1'])
  })

  it('block 钩子在其直属元素之前、且覆盖全部后代 block', () => {
    const inner: ContentBlock = [text(10)]
    const branchBody: ContentBlock = [text(20)]
    const root: ContentBlock = [group(choice('c', inner)), cond(branchBody)]
    const order: string[] = []
    visitBlockTree<null>(root, null, {
      block: (b) => order.push(`block(${b.length === 0 ? 'empty' : b[0]!.kind}:${(b[0] as TextLine | undefined)?.line ?? '?'})`),
      element: (el) => order.push(`el(${el.kind})`),
    })
    // root 块先于其元素；choice body(inner) 与 branch body 各自作为 block 覆盖
    expect(order).toEqual([
      'block(choiceGroup:0)', // root：首元素是 choiceGroup（line 0）
      'el(choiceGroup)',
      'block(text:10)',       // c.body = inner
      'el(text)',
      'el(conditional)',
      'block(text:20)',       // branch body
      'el(text)',
    ])
  })

  it('语境沿树向下线程化：choice 返回的子语境传给其 body', () => {
    const root: ContentBlock = [group(choice('c0', [group(choice('c0a', []))]))]
    const paths: string[] = []
    visitBlockTree<string>(root, 'R', {
      choice: (c, _via, _i, ctx) => {
        const child = `${ctx}/${c.label}`
        paths.push(child)
        return child
      },
    })
    expect(paths).toEqual(['R/c0', 'R/c0/c0a'])
  })

  it('via / index 为所在元素下标与 choice 下标', () => {
    const root: ContentBlock = [text(0), group(choice('a', []), choice('b', []))]
    const coords: string[] = []
    visitBlockTree<null>(root, null, {
      choice: (c, via, index) => (coords.push(`${c.label}@${via}.${index}`), null),
    })
    expect(coords).toEqual(['a@1.0', 'b@1.1']) // choiceGroup 在下标 1，两个 choice 下标 0/1
  })
})
