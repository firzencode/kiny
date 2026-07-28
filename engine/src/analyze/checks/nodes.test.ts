import { describe, it, expect } from 'vitest'
import { parse } from '../../parser'
import { buildSymbolTable } from '../symbols'
import { checkNodes } from './nodes'

const run = (...srcs: string[]) => {
  const files = srcs.map((s, i) => parse(s, `f${i}.kin`))
  return checkNodes(buildSymbolTable(files))
}

const BASE = ['=== 商店 ===', '-> END', '= 内室', '-> END', '=== 店(cat, disc) ===', '{cat}{disc}', '-> END'].join('\n')

describe('checkNodes —— $nodes 字面访问的编译期校验', () => {
  it('正例：字面属性 / 下标 / 两级 / END 零诊断', () => {
    const src = [
      '~ let a = $nodes.商店',
      '~ let b = $nodes["商店"]',
      '~ let c = $nodes.商店.内室',
      '~ let d = $nodes["商店.内室"]',
      '~ let e = $nodes.END',
      BASE,
    ].join('\n')
    expect(run(src)).toEqual([])
  })

  it('字面访问不存在的节点报 unknown-node', () => {
    const ds = run(['~ let a = $nodes.乌有乡', BASE].join('\n'))
    expect(ds.map((d) => d.code)).toContain('unknown-node')
  })

  it('两级字面访问不存在的 stitch 报 unknown-node', () => {
    const ds = run(['~ let a = $nodes.商店.没这间', BASE].join('\n'))
    expect(ds.map((d) => d.code)).toContain('unknown-node')
    const ds2 = run(['~ let a = $nodes["商店.没这间"]', BASE].join('\n'))
    expect(ds2.map((d) => d.code)).toContain('unknown-node')
  })

  it('字面调用 arity 不符报 node-arity', () => {
    const ds = run(['~ let a = $nodes.店("酒")', BASE].join('\n'))
    expect(ds.map((d) => d.code)).toContain('node-arity')
  })

  it('字面调用 arity 相符放行', () => {
    expect(run(['~ let a = $nodes.店("酒", 0.8)', BASE].join('\n'))).toEqual([])
  })

  it('stitch / END 字面调用报 node-not-callable', () => {
    const ds = run(['~ let a = $nodes.商店.内室()', BASE].join('\n'))
    expect(ds.map((d) => d.code)).toContain('node-not-callable')
    const ds2 = run(['~ let a = $nodes.END()', BASE].join('\n'))
    expect(ds2.map((d) => d.code)).toContain('node-not-callable')
  })

  it('计算下标（$nodes[变量]）留给运行时，放行', () => {
    expect(run(['~ let k = "商店"', '~ let a = $nodes[k]', BASE].join('\n'))).toEqual([])
  })

  it('合成开场 knot 名不可经字面下标访问', () => {
    const ds = run(['~ let a = $nodes[" opening:f0.kin"]', BASE].join('\n'))
    expect(ds.map((d) => d.code)).toContain('unknown-node')
  })

  it('局部遮蔽的 $nodes 不检查（形参同名）', () => {
    expect(run(['~ let f = ($nodes) => $nodes.乌有乡', BASE].join('\n'))).toEqual([])
  })

  it('插值 / 跳转表达式里的字面访问同样覆盖', () => {
    const src = ['=== A ===', '{$nodes.乌有乡}', '-> END', BASE].join('\n')
    const ds = run(src)
    expect(ds.map((d) => d.code)).toContain('unknown-node')
  })
})
