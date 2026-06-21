import { describe, it, expect } from 'vitest'
import { analyzeJs } from './js-scope'

const ok = (r: ReturnType<typeof analyzeJs>) => {
  if ('error' in r) throw new Error('unexpected syntax error: ' + r.error)
  return r
}

describe('analyzeJs —— 引用', () => {
  it('表达式：自由引用', () => {
    const r = ok(analyzeJs('gold > 5 ? "富" : "穷"', 'expr'))
    expect(r.references).toContain('gold')
    expect(r.declares).toEqual([])
  })
  it('成员访问只算根标识符', () => {
    const r = ok(analyzeJs('player.hp - 10', 'expr'))
    expect(r.references).toContain('player')
    expect(r.references).not.toContain('hp')
  })
  it('计算成员访问算键', () => {
    const r = ok(analyzeJs('obj[key]', 'expr'))
    expect(r.references.sort()).toEqual(['key', 'obj'])
  })
  it('对象字面量的键不算引用', () => {
    const r = ok(analyzeJs('{ name: who, age: 1 }', 'expr'))
    expect(r.references).toContain('who')
    expect(r.references).not.toContain('name')
    expect(r.references).not.toContain('age')
  })
})

describe('analyzeJs —— 声明', () => {
  it('语句：顶层 let/const/function 进 declares', () => {
    const r = ok(analyzeJs('let x = 0\nconst Y = 1\nfunction f(a){ return a }', 'stmt'))
    expect(r.declares.sort()).toEqual(['Y', 'f', 'x'])
  })
  it('片段内声明的名字不算自由引用', () => {
    const r = ok(analyzeJs('let total = 0\nfor (const it of items) total += it', 'stmt'))
    expect(r.references).toContain('items')
    expect(r.references).not.toContain('total')
    expect(r.references).not.toContain('it')
  })
  it('函数参数不算自由引用', () => {
    const r = ok(analyzeJs('function describe(x){ return x > 50 ? "好" : "弱" }', 'stmt'))
    expect(r.references).not.toContain('x')
    expect(r.declares).toContain('describe')
  })
  it('箭头函数参数与解构按声明处理', () => {
    const r = ok(analyzeJs('arr.map(({ id }) => id + base)', 'expr'))
    expect(r.references.sort()).toEqual(['arr', 'base'])
    expect(r.references).not.toContain('id')
  })
  it('块级 let 在块内可见、不外泄为自由引用', () => {
    const r = ok(analyzeJs('for (const it of items) { let doubled = it * 2\n total += doubled }', 'stmt'))
    expect(r.references.sort()).toEqual(['items', 'total'])
    expect(r.references).not.toContain('it')
    expect(r.references).not.toContain('doubled')
  })
  it('catch 参数不算自由引用', () => {
    const r = ok(analyzeJs('try { risky() } catch (e) { log(e) }', 'stmt'))
    expect(r.references).toContain('risky')
    expect(r.references).toContain('log')
    expect(r.references).not.toContain('e')
  })
  it('标签语句的标签不算引用', () => {
    const r = ok(analyzeJs('outer: for (const x of xs) { if (x) break outer }', 'stmt'))
    expect(r.references).toContain('xs')
    expect(r.references).not.toContain('outer')
    expect(r.references).not.toContain('x')
  })
  it('class 声明名与方法名不算自由引用', () => {
    const r = ok(analyzeJs('class Foo { m() { return base } }', 'stmt'))
    expect(r.references).toContain('base')
    expect(r.references).not.toContain('Foo')
    expect(r.references).not.toContain('m')
    expect(r.declares).toContain('Foo')
  })
})

describe('analyzeJs —— 语法错误', () => {
  it('片段写错返回 error', () => {
    const r = analyzeJs('gold +', 'expr')
    expect('error' in r).toBe(true)
  })
})
