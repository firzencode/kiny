import type { Knot, Stitch } from '../parser/ast'
import { RuntimeError } from './types'

/**
 * 节点引用：引擎签发的值，带内部 Symbol 标记（模块私有、不导出）——只有从 `$nodes` 取出的才算
 * 节点引用，作者在 JS 里拼结构相同的普通对象无法冒充。引用记录规范化完整路径（`商店` / `商店.内室`）；
 * 带参 knot 的引用可调用（实参创建时求值、arity 当场校验），返回绑定实参的新引用。
 */
const NODE_REF = Symbol('kin.nodeRef')

export interface NodeRefData {
  /** 规范化完整路径：`商店` / `商店.内室` / `END` / `DONE`。 */
  path: string
  /** 绑定实参（创建时已求值）；null = 未绑定。 */
  args: unknown[] | null
}

/** 读取节点引用的内部数据；非引用返回 null（唯一读口，Symbol 不外泄）。 */
export function nodeRefData(v: unknown): NodeRefData | null {
  if ((typeof v === 'function' || (typeof v === 'object' && v !== null)) === false) return null
  const d = (v as Record<symbol, unknown>)[NODE_REF]
  return (d as NodeRefData | undefined) ?? null
}

export function isNodeRef(v: unknown): boolean {
  return nodeRefData(v) !== null
}

export interface Nodes {
  /** `$nodes` 根对象（注入 B 层）。 */
  root: unknown
  /** 读档重建：按路径（+ 绑定实参）签发引用；节点不存在 / arity 不符抛**普通 Error**（restore 判 corrupt）。 */
  revive(path: string, args?: unknown[]): unknown
}

/** JS / 引擎协议探测属性：访问不抛、返回 undefined（'toString' 单独处理，不在此列）。 */
const PROTOCOL_PROPS = new Set([
  'then', 'toJSON', 'valueOf', 'constructor', 'name', 'length',
  'call', 'apply', 'bind', 'prototype', 'inspect',
])

/**
 * 构建 `$nodes` 两级只读节点表（Proxy 访问即校验）。
 * - 合成开场 knot（`scope === 'global'`）不暴露：不入枚举、访问抛「节点不存在」。
 * - 基础（未绑参）引用按路径缓存单例，`$nodes.商店 === $nodes.商店` 成立。
 * - `Object.keys($nodes)` 枚举全部作者 knot 名（不含 END/DONE 伪引用）。
 */
export function makeNodes(
  knots: Map<string, Knot>,
  stitches: Map<string, Map<string, Stitch>>,
): Nodes {
  const refCache = new Map<string, unknown>()

  const authorKnot = (name: string): Knot | null => {
    const k = knots.get(name)
    return k !== undefined && k.scope !== 'global' ? k : null
  }

  /** 签发一个引用（Proxy over 箭头函数以支持可调用；get 虚拟出 stitch 链 / toString）。 */
  function makeRef(data: NodeRefData, knot: Knot | null): unknown {
    // target 用箭头函数：无 prototype 自有键，ownKeys 默认反射不受 non-configurable 不变量拖累。
    const target = () => undefined
    const ref: unknown = new Proxy(target, {
      get(t, prop) {
        if (prop === NODE_REF) return data
        if (typeof prop === 'symbol') {
          if (prop === Symbol.toPrimitive) return () => data.path
          return undefined
        }
        if (prop === 'toString' && (knot === null || !hasStitch(knot.name, prop))) {
          return () => data.path
        }
        // knot 引用：与子节点同名的内建属性以子节点解析优先。
        if (knot !== null && data.args === null && hasStitch(knot.name, prop)) {
          return baseRef(`${knot.name}.${prop}`)
        }
        if (PROTOCOL_PROPS.has(prop)) return undefined // 不反射 target（避免泄漏内部函数的 name/length）
        if (knot !== null && data.args === null) {
          throw new RuntimeError(`节点不存在：「${data.path}.${prop}」`)
        }
        return undefined // stitch / END / DONE / 绑参引用：无子节点可取，宽容返回 undefined
      },
      apply(_t, _thisArg, callArgs) {
        if (data.args !== null) {
          throw new RuntimeError(`引用「${data.path}」已绑定实参，不能再次调用`)
        }
        if (knot === null) {
          if (data.path === 'END' || data.path === 'DONE') {
            throw new RuntimeError(`${data.path} 引用不可调用`)
          }
          throw new RuntimeError(`子节点引用不可调用（子节点无参数）：「${data.path}」`)
        }
        if (callArgs.length !== knot.params.length) {
          throw new RuntimeError(
            `节点「${knot.name}」需 ${knot.params.length} 个实参，调用给了 ${callArgs.length} 个`,
          )
        }
        return makeRef({ path: data.path, args: callArgs }, knot)
      },
      set() {
        throw new RuntimeError(`节点引用只读，不能修改属性：「${data.path}」`)
      },
      defineProperty() {
        throw new RuntimeError(`节点引用只读，不能修改属性：「${data.path}」`)
      },
      deleteProperty() {
        throw new RuntimeError(`节点引用只读，不能修改属性：「${data.path}」`)
      },
    })
    return ref
  }

  const hasStitch = (knotName: string, stitchName: string): boolean =>
    stitches.get(knotName)?.has(stitchName) ?? false

  /**
   * 解析路径签发基础（未绑参）引用；不存在返回 null。
   * END/DONE 伪引用、knot、`父.子` stitch 全路径均在此统一解析（合成开场 knot 拒）。
   */
  function resolveBase(path: string): { knot: Knot | null } | null {
    if (path === 'END' || path === 'DONE') return { knot: null }
    const dot = path.indexOf('.')
    if (dot !== -1) {
      const parent = path.slice(0, dot)
      const child = path.slice(dot + 1)
      return authorKnot(parent) !== null && hasStitch(parent, child) ? { knot: null } : null
    }
    const k = authorKnot(path)
    return k !== null ? { knot: k } : null
  }

  /** 取（或建）基础引用单例；不存在返回 null。 */
  function baseRef(path: string): unknown | null {
    const cached = refCache.get(path)
    if (cached !== undefined) return cached
    const r = resolveBase(path)
    if (r === null) return null
    const ref = makeRef({ path, args: null }, r.knot)
    refCache.set(path, ref)
    return ref
  }

  const authorKnotNames = (): string[] => {
    const out: string[] = []
    for (const [name, k] of knots) if (k.scope !== 'global') out.push(name)
    return out
  }

  const root = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined
      const ref = baseRef(prop)
      if (ref !== null) return ref
      if (prop === 'toString') return () => '$nodes'
      if (PROTOCOL_PROPS.has(prop)) return undefined
      throw new RuntimeError(`节点不存在：「${prop}」`)
    },
    has(_t, prop) {
      // 准确的成员测试：`"名字" in $nodes` 是数据驱动作者的天然存在性检查（访问即抛的对偶）。
      return typeof prop === 'string' && (prop === 'toString' || PROTOCOL_PROPS.has(prop) || resolveBase(prop) !== null)
    },
    ownKeys() {
      return authorKnotNames()
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop === 'symbol') return undefined
      if (authorKnot(prop) === null) return undefined
      return { value: baseRef(prop), enumerable: true, configurable: true, writable: false }
    },
    set() {
      throw new RuntimeError('$nodes 只读，不能赋值')
    },
    defineProperty() {
      throw new RuntimeError('$nodes 只读，不能赋值')
    },
    deleteProperty() {
      throw new RuntimeError('$nodes 只读，不能赋值')
    },
  })

  function revive(path: string, args?: unknown[]): unknown {
    const base = baseRef(path)
    if (base === null) throw new Error(`存档引用的节点不存在：「${path}」`)
    if (args === undefined) return base
    // 绑参重建：只有带参 knot 引用可绑（与运行期调用同规则），但抛普通 Error 供 restore 判 corrupt。
    const dot = path.indexOf('.')
    const k = dot === -1 ? authorKnot(path) : null
    if (k === null) throw new Error(`存档引用绑定实参的目标不可调用：「${path}」`)
    if (args.length !== k.params.length) {
      throw new Error(`存档引用「${path}」实参 ${args.length} 个，节点需 ${k.params.length} 个`)
    }
    return makeRef({ path, args }, k)
  }

  return { root, revive }
}
