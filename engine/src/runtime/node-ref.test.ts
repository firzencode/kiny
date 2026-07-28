import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { makeNodes, isNodeRef, nodeRefData } from './node-ref'
import { RuntimeError } from './types'

/** 从源码建 makeNodes 所需的 knots/stitches 表（走 analyze，含合成开场 knot）。 */
function nodesOf(src: string, path = 'main.kin') {
  const program = analyze([parse(src, path)]).program
  if (!program) throw new Error('analyze 有 error，fixture 不合法')
  return makeNodes(program.knots, program.stitches)
}

const SRC = `
开场文本
=== 商店 ===
店里
-> END
= 内室
内室里
-> END
=== 大厅 ===
-> END
=== 遭遇1 ===
-> END
=== 带参店(item, rate) ===
{item}{rate}
-> END
`

describe('$nodes 根表', () => {
  it('访问存在的 knot 得到引用，路径与 toString 正确', () => {
    const { root } = nodesOf(SRC)
    const r = (root as Record<string, unknown>)['商店']
    expect(isNodeRef(r)).toBe(true)
    expect(nodeRefData(r)).toEqual({ path: '商店', args: null })
    expect(String(r)).toBe('商店')
    expect(`${r}`).toBe('商店')
  })

  it('两级访问得到 stitch 引用（属性链与带点下标等价）', () => {
    const { root } = nodesOf(SRC)
    const viaChain = ((root as Record<string, unknown>)['商店'] as Record<string, unknown>)['内室']
    const viaKey = (root as Record<string, unknown>)['商店.内室']
    expect(nodeRefData(viaChain)).toEqual({ path: '商店.内室', args: null })
    expect(viaChain).toBe(viaKey) // 单例缓存：两种写法同一引用
  })

  it('基础引用是单例（=== 可比）', () => {
    const { root } = nodesOf(SRC)
    const o = root as Record<string, unknown>
    expect(o['商店']).toBe(o['商店'])
  })

  it('访问不存在的节点当场抛 RuntimeError', () => {
    const { root } = nodesOf(SRC)
    expect(() => (root as Record<string, unknown>)['不存在']).toThrow(RuntimeError)
    expect(() => (root as Record<string, unknown>)['不存在']).toThrow('节点不存在：「不存在」')
    expect(() => ((root as Record<string, unknown>)['商店'] as Record<string, unknown>)['没这间']).toThrow(
      '节点不存在：「商店.没这间」',
    )
    expect(() => (root as Record<string, unknown>)['大厅.没有']).toThrow('节点不存在：「大厅.没有」')
  })

  it('合成开场 knot 不暴露（枚举不含、下标访问抛）', () => {
    const nodes = nodesOf(SRC)
    const keys = Object.keys(nodes.root as object)
    expect(keys).toEqual(['商店', '大厅', '遭遇1', '带参店'])
    expect(() => (nodes.root as Record<string, unknown>)[' opening:main.kin']).toThrow(RuntimeError)
  })

  it('END / DONE 伪引用可取、不入枚举', () => {
    const { root } = nodesOf(SRC)
    const o = root as Record<string, unknown>
    expect(nodeRefData(o['END'])).toEqual({ path: 'END', args: null })
    expect(nodeRefData(o['DONE'])).toEqual({ path: 'DONE', args: null })
    expect(Object.keys(root as object)).not.toContain('END')
  })

  it('symbol 属性访问不抛（协议探测安全）', () => {
    const { root } = nodesOf(SRC)
    expect((root as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined()
    const r = (root as Record<string, unknown>)['商店'] as Record<string, unknown>
    expect(r['then']).toBeUndefined() // thenable 探测不抛
    expect(r['toJSON']).toBeUndefined()
  })

  it('$nodes 只读：属性赋值 / 删除抛', () => {
    const { root } = nodesOf(SRC)
    expect(() => {
      ;(root as Record<string, unknown>)['商店'] = 1
    }).toThrow(RuntimeError)
    expect(() => {
      delete (root as Record<string, unknown>)['商店']
    }).toThrow(RuntimeError)
  })

  it('in 运算符是准确的成员测试（访问即抛的对偶）', () => {
    const { root } = nodesOf(SRC)
    const o = root as Record<string, unknown>
    expect('商店' in o).toBe(true)
    expect('商店.内室' in o).toBe(true)
    expect('END' in o).toBe(true)
    expect('乌有乡' in o).toBe(false)
    expect(' opening:main.kin' in o).toBe(false) // 合成开场 knot 不算成员
  })

  it('引用的协议属性不泄漏内部实现（name/length 为 undefined）', () => {
    const { root } = nodesOf(SRC)
    const r = (root as Record<string, unknown>)['商店'] as Record<string, unknown>
    expect(r['name']).toBeUndefined()
    expect(r['length']).toBeUndefined()
  })

  it('作者伪造的普通对象不算节点引用', () => {
    expect(isNodeRef({ path: '商店', args: null })).toBe(false)
    expect(isNodeRef('商店')).toBe(false)
    expect(isNodeRef(null)).toBe(false)
    expect(nodeRefData(undefined)).toBe(null)
  })
})

describe('可调用引用（带参绑定）', () => {
  it('带参 knot 调用返回绑参新引用，实参已求值', () => {
    const { root } = nodesOf(SRC)
    const f = (root as Record<string, unknown>)['带参店'] as (...a: unknown[]) => unknown
    const bound = f('灯笼', 0.8)
    expect(nodeRefData(bound)).toEqual({ path: '带参店', args: ['灯笼', 0.8] })
    expect(String(bound)).toBe('带参店')
  })

  it('arity 不符当场抛', () => {
    const { root } = nodesOf(SRC)
    const f = (root as Record<string, unknown>)['带参店'] as (...a: unknown[]) => unknown
    expect(() => f('只有一个')).toThrow('节点「带参店」需 2 个实参，调用给了 1 个')
  })

  it('无参 knot 调用须 0 实参，返回等价引用', () => {
    const { root } = nodesOf(SRC)
    const f = (root as Record<string, unknown>)['商店'] as (...a: unknown[]) => unknown
    const r = f()
    expect(nodeRefData(r)).toEqual({ path: '商店', args: [] })
    expect(() => f(1)).toThrow('节点「商店」需 0 个实参，调用给了 1 个')
  })

  it('已绑定的引用再调用抛', () => {
    const { root } = nodesOf(SRC)
    const f = (root as Record<string, unknown>)['带参店'] as (...a: unknown[]) => unknown
    const bound = f('灯笼', 0.8) as (...a: unknown[]) => unknown
    expect(() => bound('再来')).toThrow(RuntimeError)
  })

  it('stitch / END / DONE 引用不可调用', () => {
    const { root } = nodesOf(SRC)
    const o = root as Record<string, unknown>
    expect(() => (o['商店.内室'] as () => unknown)()).toThrow('子节点引用不可调用')
    expect(() => (o['END'] as () => unknown)()).toThrow(RuntimeError)
  })
})

describe('revive（读档重建）', () => {
  it('按路径重建无参 / 绑参引用', () => {
    const nodes = nodesOf(SRC)
    const r = nodes.revive('商店.内室')
    expect(nodeRefData(r)).toEqual({ path: '商店.内室', args: null })
    expect(r).toBe((nodes.root as Record<string, unknown>)['商店.内室']) // 未绑参走同一单例
    const b = nodes.revive('带参店', ['灯笼', 0.8])
    expect(nodeRefData(b)).toEqual({ path: '带参店', args: ['灯笼', 0.8] })
    expect(nodeRefData(nodes.revive('END'))).toEqual({ path: 'END', args: null })
  })

  it('节点不存在 / arity 不符 / stitch 带参 → 抛普通 Error（非 RuntimeError）', () => {
    const nodes = nodesOf(SRC)
    expect(() => nodes.revive('已删除')).toThrow('存档引用的节点不存在：「已删除」')
    expect(() => nodes.revive('已删除')).not.toThrow(RuntimeError)
    expect(() => nodes.revive('带参店', ['太', '多', '了'])).toThrow(Error)
    expect(() => nodes.revive('商店.内室', ['x'])).toThrow(Error)
    expect(() => nodes.revive(' opening:main.kin')).toThrow(Error)
  })
})
