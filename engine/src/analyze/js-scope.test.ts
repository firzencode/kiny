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

describe('analyzeJs —— B1 作用域修复', () => {
  it('参数默认值可引用前序参数（不误判自由引用）', () => {
    const r = ok(analyzeJs('let f = (a, b = a) => b', 'stmt'))
    expect(r.references).not.toContain('a')
    expect(r.declares).toContain('f')
  })
  it('参数默认值引用后序参数仍算自由（TDZ，正确报出）', () => {
    const r = ok(analyzeJs('let f = (a = b, b) => a', 'stmt'))
    expect(r.references).toContain('b')
  })
  it('var 提升到函数作用域：块内声明、块外可见', () => {
    const r = ok(analyzeJs('function g(){ if(1){ var x = 1 } return x }', 'stmt'))
    expect(r.references).not.toContain('x')
    expect(r.declares).toContain('g')
  })
  it('顶层 var 进 declares、嵌套 var 不进（导出语义与 topDeclares 一致）', () => {
    const r = ok(analyzeJs('var y = 1; if(1){ var z = 2 }', 'stmt'))
    expect(r.declares).toContain('y')
    expect(r.declares).not.toContain('z')
  })
})

describe('analyzeJs —— A7 赋值目标', () => {
  it('自由标识符赋值目标进 assigns', () => {
    expect(ok(analyzeJs('random = 5', 'stmt')).assigns).toContain('random')
  })
  it('自增/自减也算赋值', () => {
    expect(ok(analyzeJs('random++', 'stmt')).assigns).toContain('random')
  })
  it('局部变量赋值不进 assigns', () => {
    expect(ok(analyzeJs('let x = 1; x = 2', 'stmt')).assigns).not.toContain('x')
  })
  it('成员赋值不算裸标识符赋值', () => {
    expect(ok(analyzeJs('obj.random = 5', 'stmt')).assigns).not.toContain('random')
  })
})

describe('analyzeJs —— $nodes 字面访问收集', () => {
  const nn = (code: string, mode: 'expr' | 'stmt' = 'stmt') => ok(analyzeJs(code, mode)).nodesAccess

  it('字面属性访问', () => {
    expect(nn('let a = $nodes.商店')).toEqual([{ path: '商店', argc: null }])
  })
  it('字符串字面量下标（含带点全路径）', () => {
    expect(nn('let a = $nodes["商店"]')).toEqual([{ path: '商店', argc: null }])
    expect(nn('let a = $nodes["商店.内室"]')).toEqual([{ path: '商店.内室', argc: null }])
  })
  it('两级属性链只记全路径（不重复记一级）', () => {
    expect(nn('let a = $nodes.商店.内室')).toEqual([{ path: '商店.内室', argc: null }])
  })
  it('字面调用记 argc', () => {
    expect(nn('let a = $nodes.店("酒", 1)')).toEqual([{ path: '店', argc: 2 }])
    expect(nn('let a = $nodes.商店.内室()')).toEqual([{ path: '商店.内室', argc: 0 }])
  })
  it('计算下标不记（留给运行时）', () => {
    expect(nn('let a = $nodes[k]')).toEqual([])
    expect(nn('let a = $nodes[k].x')).toEqual([])
  })
  it('三级链记两级前缀', () => {
    expect(nn('let a = $nodes.a.b.c')).toEqual([{ path: 'a.b', argc: null }])
  })
  it('局部遮蔽的 $nodes 不记', () => {
    expect(nn('let f = ($nodes) => $nodes.商店')).toEqual([])
  })
  it('表达式模式同样收集', () => {
    expect(nn('$nodes.商店', 'expr')).toEqual([{ path: '商店', argc: null }])
  })
})
