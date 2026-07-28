import { describe, it, expect } from 'vitest'
import { encodeGlobals, decodeGlobals } from './scope-codec'
import { RuntimeError } from './types'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { makeNodes, nodeRefData } from './node-ref'

/** 经真实落盘路径（JSON 往返）编解码一个作用域。 */
const rt = (scope: Record<string, unknown>): Record<string, unknown> =>
  decodeGlobals(JSON.parse(JSON.stringify(encodeGlobals(scope))))

describe('scope-codec 白名单容器编解码', () => {
  it('Map 往返保真（含内容）', () => {
    const out = rt({ m: new Map<string, number>([['剑', 3], ['盾', 1]]) })
    expect(out.m).toBeInstanceOf(Map)
    expect((out.m as Map<string, number>).get('剑')).toBe(3)
    expect((out.m as Map<string, number>).size).toBe(2)
  })

  it('Set 往返保真', () => {
    const out = rt({ s: new Set(['a', 'b', 'a']) })
    expect(out.s).toBeInstanceOf(Set)
    expect([...(out.s as Set<string>)]).toEqual(['a', 'b'])
  })

  it('Date 往返保真（同一时刻）', () => {
    const d = new Date('2026-07-20T08:30:00.000Z')
    const out = rt({ d })
    expect(out.d).toBeInstanceOf(Date)
    expect((out.d as Date).toISOString()).toBe(d.toISOString())
  })

  it('嵌套：Map 装对象、对象装 Set、数组装 Date 逐层还原', () => {
    const d = new Date('2026-01-01T00:00:00.000Z')
    const out = rt({
      m: new Map<string, unknown>([['k', { tags: new Set(['x']) }]]),
      arr: [d, { n: 1 }],
    })
    const m = out.m as Map<string, { tags: Set<string> }>
    expect(m.get('k')!.tags).toBeInstanceOf(Set)
    expect([...m.get('k')!.tags]).toEqual(['x'])
    const arr = out.arr as [Date, { n: number }]
    expect(arr[0]).toBeInstanceOf(Date)
    expect(arr[0].toISOString()).toBe(d.toISOString())
    expect(arr[1]).toEqual({ n: 1 })
  })

  it('Map 非字符串键（对象键 / 数字键）往返后保留', () => {
    const key = { id: 7 }
    const out = rt({ m: new Map<unknown, string>([[key, '对象键'], [42, '数字键']]) })
    const m = out.m as Map<unknown, string>
    expect(m.size).toBe(2)
    // 键经值拷贝还原：找回对象键（内容相等）
    const objEntry = [...m.entries()].find(([, v]) => v === '对象键')
    expect(objEntry![0]).toEqual({ id: 7 })
    expect(m.get(42)).toBe('数字键')
  })

  it('哨兵冲突：作者对象含 __kin 键往返后仍是普通对象、键值不变', () => {
    const out = rt({ o: { __kin: '自定义', x: 1, nested: new Set([9]) } })
    const o = out.o as { __kin: string; x: number; nested: Set<number> }
    expect(o.__kin).toBe('自定义')
    expect(o.x).toBe(1)
    expect(o.nested).toBeInstanceOf(Set) // 转义壳内的白名单值照常还原
    expect([...o.nested]).toEqual([9])
  })

  it('函数被丢弃（键略去），普通值保留', () => {
    const out = rt({ f: () => 1, obj: { fn: () => 2, x: 5 } })
    expect('f' in out).toBe(false)
    expect(out.obj).toEqual({ x: 5 })
  })

  it('真正的循环引用 → 抛 RuntimeError，消息含变量名', () => {
    const m = new Map<string, unknown>()
    m.set('me', m)
    expect(() => encodeGlobals({ 背包: m })).toThrow(RuntimeError)
    expect(() => encodeGlobals({ 背包: m })).toThrow('背包')
  })

  it('DAG 共享子对象：往返后内容相等，但成独立副本（不保持引用同一性）', () => {
    const shared = { hp: 10 }
    const out = rt({ a: shared, b: shared })
    expect(out.a).toEqual({ hp: 10 })
    expect(out.b).toEqual({ hp: 10 })
    expect(out.a).not.toBe(out.b) // 值拷贝，非同一引用
  })

  it('白名单外类实例自带 __kin 保留 tag 键 → decode 不崩、降级为普通对象（不误当容器）', () => {
    // 类实例走 passthrough 原样落盘，其自有 __kin='Map' 键无 v 载荷；decode 须形状校验后降级，
    // 否则 v.map on undefined 崩 → 整份存档 restore 失败判 corrupt（比现状失真更糟）。
    class Poison {
      __kin = 'Map'
      x = 3
    }
    const out = rt({ p: new Poison() })
    expect(out.p).not.toBeInstanceOf(Map)
    expect(out.p).toEqual({ __kin: 'Map', x: 3 }) // 降级为普通对象、键值保留
    // Date tag 缺字符串载荷同样降级、不产 Invalid Date
    class PoisonDate {
      __kin = 'Date'
      y = 1
    }
    expect(rt({ d: new PoisonDate() }).d).toEqual({ __kin: 'Date', y: 1 })
  })

  it('白名单外（WeakMap / 自定义类实例）→ 现状失真，不抛错', () => {
    class Foo {
      constructor(public x = 1) {}
      greet() {
        return 'hi'
      }
    }
    const out = rt({ w: new WeakMap(), foo: new Foo(3) })
    expect(out.w).not.toBeInstanceOf(WeakMap) // WeakMap 内容不可枚举 → {}
    expect(out.foo).not.toBeInstanceOf(Foo) // 类实例降为普通对象、方法丢失
    expect(out.foo).toEqual({ x: 3 }) // 自有可枚举属性仍在（JSON 默认行为）
  })
})

describe('scope-codec —— Node 标签（节点引用往返）', () => {
  const SRC = ['=== 商店 ===', '-> END', '= 内室', '-> END', '=== 带参店(item, rate) ===', '{item}{rate}', '-> END'].join('\n')

  function nodesOf() {
    const program = analyze([parse(SRC, 'main.kin')]).program
    if (!program) throw new Error('fixture 不合法')
    return makeNodes(program.knots, program.stitches)
  }

  /** 经 JSON 往返 + reviveNode 解码。 */
  const rtn = (scope: Record<string, unknown>, nodes: ReturnType<typeof nodesOf>) =>
    decodeGlobals(JSON.parse(JSON.stringify(encodeGlobals(scope))), (p, a) => nodes.revive(p, a))

  it('无参 knot / stitch 引用编码为 Node 标签并经 revive 还原', () => {
    const nodes = nodesOf()
    const o = nodes.root as Record<string, unknown>
    const enc = encodeGlobals({ a: o['商店'], b: o['商店.内室'] })
    expect(enc.a).toEqual({ __kin: 'Node', v: '商店' })
    expect(enc.b).toEqual({ __kin: 'Node', v: '商店.内室' })
    const out = rtn({ a: o['商店'], b: o['商店.内室'] }, nodes)
    expect(nodeRefData(out.a)).toEqual({ path: '商店', args: null })
    expect(nodeRefData(out.b)).toEqual({ path: '商店.内室', args: null })
  })

  it('绑参引用带 args 编码（递归，含 Map）且往返还原', () => {
    const nodes = nodesOf()
    const f = (nodes.root as Record<string, unknown>)['带参店'] as (...a: unknown[]) => unknown
    const bound = f('灯笼', new Map([['折', 8]]))
    const out = rtn({ t: bound }, nodes)
    const d = nodeRefData(out.t)!
    expect(d.path).toBe('带参店')
    expect(d.args![0]).toBe('灯笼')
    expect(d.args![1]).toBeInstanceOf(Map)
    expect((d.args![1] as Map<string, number>).get('折')).toBe(8)
  })

  it('引用藏在容器里（数组 / Map 值）同样往返', () => {
    const nodes = nodesOf()
    const o = nodes.root as Record<string, unknown>
    const out = rtn({ arr: [o['商店']], m: new Map([['k', o['商店.内室']]]) }, nodes)
    expect(nodeRefData((out.arr as unknown[])[0])).toEqual({ path: '商店', args: null })
    expect(nodeRefData((out.m as Map<string, unknown>).get('k'))).toEqual({ path: '商店.内室', args: null })
  })

  it('END 伪引用往返', () => {
    const nodes = nodesOf()
    const out = rtn({ e: (nodes.root as Record<string, unknown>)['END'] }, nodes)
    expect(nodeRefData(out.e)).toEqual({ path: 'END', args: null })
  })

  it('读档时节点已删除 → reviveNode 抛（明确报错而非静默坏掉）', () => {
    const nodes = nodesOf()
    const enc = JSON.parse(JSON.stringify({ t: { __kin: 'Node', v: '已删除的节点' } }))
    expect(() => decodeGlobals(enc, (p, a) => nodes.revive(p, a))).toThrow(/存档引用的节点不存在/)
  })

  it('无 reviveNode 时 Node 标签降级为普通对象（不崩）', () => {
    const out = decodeGlobals({ t: { __kin: 'Node', v: '商店' } })
    expect(out.t).toEqual({ __kin: 'Node', v: '商店' })
  })

  it('作者伪造 { __kin:"Node" } 形状不符时降级不崩', () => {
    const nodes = nodesOf()
    const out = decodeGlobals({ t: { __kin: 'Node', v: 42 } }, (p, a) => nodes.revive(p, a))
    expect(out.t).toEqual({ __kin: 'Node', v: 42 })
  })
})
