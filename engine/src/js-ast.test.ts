import { describe, it, expect } from 'vitest'
import { parse } from 'acorn'
import { forEachChild, collectPatternNames, type AstNode } from './js-ast'

const expr = (code: string): AstNode => (parse(`(${code})`, { ecmaVersion: 'latest' }) as AstNode)
const firstDeclId = (code: string): AstNode => {
  const prog = parse(code, { ecmaVersion: 'latest' }) as AstNode
  return prog.body[0].declarations[0].id
}

describe('forEachChild —— 通用兜底走查', () => {
  it('下钻数组与对象子节点，收集所有 Identifier', () => {
    const names: string[] = []
    const visit = (n: AstNode): void => {
      if (n.type === 'Identifier') names.push(n.name)
      forEachChild(n, visit)
    }
    visit(expr('f(a, b + c)'))
    expect(names.sort()).toEqual(['a', 'b', 'c', 'f'])
  })

  it('跳过 type/start/end 元字段（不把它们当子节点）', () => {
    let count = 0
    const visit = (n: AstNode): void => {
      count++
      forEachChild(n, visit)
    }
    visit(expr('x'))
    // Program → ExpressionStatement → Identifier：三个真实节点，不因 start/end 数值多走
    expect(count).toBe(3)
  })
})

describe('collectPatternNames —— 绑定名收集', () => {
  const names = (code: string): string[] => {
    const out: string[] = []
    collectPatternNames(firstDeclId(`let ${code} = 0`), (n) => out.push(n))
    return out.sort()
  }

  it('Identifier', () => expect(names('x')).toEqual(['x']))
  it('ObjectPattern（含 rest 与重命名）', () => expect(names('{ a, b: c, ...rest }')).toEqual(['a', 'c', 'rest']))
  it('ArrayPattern（含 hole 与 rest）', () => expect(names('[p, , q, ...r]')).toEqual(['p', 'q', 'r']))
  it('AssignmentPattern（默认值只取绑定名）', () => expect(names('{ a = 1 }')).toEqual(['a']))
  it('嵌套模式', () => expect(names('{ a: [b, { c }] }')).toEqual(['b', 'c']))
})
