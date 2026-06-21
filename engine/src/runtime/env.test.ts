import { describe, it, expect } from 'vitest'
import { makeScope, runStatement, evalExpr } from './env'

describe('runtime env —— with 链 + 持久化', () => {
  it('~ let 声明持久化到作用域对象，后续可读', () => {
    const B = {}, G = makeScope()
    runStatement('let gold = 10', B, G, null)
    expect(G.gold).toBe(10)
    expect(evalExpr('gold + 5', B, G, null)).toBe(15)
  })
  it('节点局部遮蔽全局，赋值落对层', () => {
    const B = {}, G = makeScope()
    runStatement('let gold = 10', B, G, null)
    const L = makeScope()
    runStatement('let gold = 1', B, G, L)
    expect(L.gold).toBe(1)
    expect(G.gold).toBe(10)
    runStatement('gold = gold + 1', B, G, L) // 命中 L
    expect(L.gold).toBe(2)
    expect(G.gold).toBe(10)
  })
  it('function 声明持久化', () => {
    const B = {}, G = makeScope()
    runStatement('function dbl(x){ return x*2 }', B, G, null)
    expect(evalExpr('dbl(21)', B, G, null)).toBe(42)
  })
  it('内置层 B 可见', () => {
    const B = { ping: () => 'pong' }, G = makeScope()
    expect(evalExpr('ping()', B, G, null)).toBe('pong')
  })
})
