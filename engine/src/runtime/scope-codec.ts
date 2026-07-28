import { RuntimeError } from './types'
import { nodeRefData } from './node-ref'

/**
 * 作用域值的白名单容器编解码：把 `Map` / `Set` / `Date` 编成纯 JSON-able 的 tagged 中间结构，
 * 读档时逆向还原，使这三类值经存读档往返保真（T076）。白名单**只含三核心**——背包 / 状态机 = Map、
 * 已解锁集合 = Set、时间戳 = Date；其余非 JSON 值（自定义类 / 含方法对象 / WeakMap 等）维持现状
 * （交 JSON.stringify 默认失真，由 analyze warning 覆盖）。函数被丢弃（restore 靠 buildGlobals 重建）。
 *
 * 不保持引用同一性（值拷贝，DAG 共享子对象还原成多份相等副本）；真正的循环引用在 encode 时抛错。
 */

/** 固定哨兵键：标记容器类型。作者普通对象若自带 `__kin` 键，编码时 wrap 成 `{__kin:'obj'}` 转义。 */
const KIN = '__kin'

/** 编码后的 tagged 中间结构（纯 JSON-able）。 */
export type Encoded =
  | { [KIN]: 'Map'; v: [Encoded, Encoded][] }
  | { [KIN]: 'Set'; v: Encoded[] }
  | { [KIN]: 'Date'; v: string }
  | { [KIN]: 'Node'; v: string; args?: Encoded[] }
  | { [KIN]: 'obj'; v: Record<string, Encoded> }
  | Encoded[]
  | { [k: string]: Encoded }
  | string
  | number
  | boolean
  | null
  | unknown // 白名单外复杂值：原样透传，交 JSON.stringify

/** 函数 / undefined 的「丢弃」标记：令其在对象里的键被略去、数组里降为 null、Map/Set 里跳过该项。 */
const DISCARD = Symbol('discard')
type Maybe = Encoded | typeof DISCARD

const isPlainObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** 编码一个作用域（G 或 L）的自有可枚举键：逐值 encode，跳过丢弃项（函数 / undefined）。 */
export function encodeGlobals(scope: Record<string, unknown>): Record<string, Encoded> {
  const out: Record<string, Encoded> = {}
  for (const [k, v] of Object.entries(scope)) {
    const enc = encodeValue(v, k, new Set())
    if (enc !== DISCARD) out[k] = enc
  }
  return out
}

/**
 * 递归编码单个值。`varName` 供循环引用报错定位；`seen` 是当前递归路径上的容器集合（进容器压入、
 * 返回前弹出）——命中即真环，抛错；DAG 共享（非祖先）不在路径栈内，照常编码成独立副本。
 */
function encodeValue(value: unknown, varName: string, seen: Set<object>): Maybe {
  // 节点引用（实现是 function 对象）：须先于「函数丢弃」判内部标记，编成 Node 标签保真。
  const ref = nodeRefData(value)
  if (ref !== null) {
    if (ref.args === null) return { [KIN]: 'Node', v: ref.path }
    const args = ref.args.map((a) => {
      const e = encodeValue(a, varName, seen)
      return e === DISCARD ? null : e // 绑参里的函数/undefined 降为 null（与数组规则一致）
    })
    return { [KIN]: 'Node', v: ref.path, args }
  }
  if (typeof value === 'function' || value === undefined) return DISCARD
  if (value === null || typeof value !== 'object') return value as Encoded // 原语原样

  if (value instanceof Date) return { [KIN]: 'Date', v: value.toISOString() }

  if (seen.has(value)) {
    throw new RuntimeError(`变量 '${varName}' 含循环引用，快照不支持循环结构`)
  }
  seen.add(value)
  try {
    if (value instanceof Map) {
      const v: [Encoded, Encoded][] = []
      for (const [k, val] of value.entries()) {
        const ek = encodeValue(k, varName, seen)
        const ev = encodeValue(val, varName, seen)
        if (ek !== DISCARD && ev !== DISCARD) v.push([ek, ev]) // 跳过键/值为函数的项
      }
      return { [KIN]: 'Map', v }
    }
    if (value instanceof Set) {
      const v: Encoded[] = []
      for (const el of value.values()) {
        const e = encodeValue(el, varName, seen)
        if (e !== DISCARD) v.push(e)
      }
      return { [KIN]: 'Set', v }
    }
    if (Array.isArray(value)) {
      return value.map((el) => {
        const e = encodeValue(el, varName, seen)
        return e === DISCARD ? null : e // 数组洞位降为 null（与 JSON.stringify 一致）
      })
    }
    if (isPlainObject(value)) {
      const fields: Record<string, Encoded> = {}
      for (const [k, val] of Object.entries(value)) {
        const e = encodeValue(val, varName, seen)
        if (e !== DISCARD) fields[k] = e // 跳过函数 / undefined 键
      }
      // 作者对象自带 __kin 键 → wrap 转义，避免解码时被误认成容器标记。
      return Object.prototype.hasOwnProperty.call(value, KIN) ? { [KIN]: 'obj', v: fields } : fields
    }
    // 白名单外复杂值（自定义类实例 / 含方法对象 / WeakMap / RegExp 等）→ 现状：原样透传，
    // 交随后的 JSON.stringify 默认处理（多变 {} / 调 toJSON），本任务不扩范围去修。
    return value as Encoded
  } finally {
    seen.delete(value)
  }
}

/** 读档重建节点引用的工厂（由 Story 提供，经 $nodes 同一签发口）；节点不存在时应抛错。 */
export type ReviveNode = (path: string, args?: unknown[]) => unknown

/** 解码一个作用域的编码结果：逐值 decode 还原 Map/Set/Date/Node/转义对象。 */
export function decodeGlobals(encoded: Record<string, unknown>, reviveNode?: ReviveNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(encoded)) out[k] = decodeValue(v, reviveNode)
  return out
}

/**
 * encode 的逆：reviver 式递归还原。tag 分派**须校验载荷形状**再解——白名单外复杂值（类实例等）
 * 会被 passthrough 原样落盘（scope-codec 不编码它们），其自有 `__kin` 键若恰为保留 tag（如
 * `class Foo { __kin = 'Map' }`），无形状校验会当成真容器解码而崩（`v.map` on undefined），令整份
 * 存档 restore 失败判 corrupt——比「白名单外维持 JSON 现状失真」的契约更糟。形状不符即降级为普通对象。
 */
function decodeValue(value: unknown, reviveNode?: ReviveNode): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((el) => decodeValue(el, reviveNode))
  const tag = (value as Record<string, unknown>)[KIN]
  const v = (value as { v?: unknown }).v
  if (tag === 'Map' && Array.isArray(v)) return new Map((v as [unknown, unknown][]).map(([k, val]) => [decodeValue(k, reviveNode), decodeValue(val, reviveNode)]))
  if (tag === 'Set' && Array.isArray(v)) return new Set((v as unknown[]).map((el) => decodeValue(el, reviveNode)))
  if (tag === 'Date' && typeof v === 'string') return new Date(v)
  if (tag === 'Node' && typeof v === 'string' && reviveNode !== undefined) {
    // 经 $nodes 同一工厂重建（含内部标记），顺带校验节点在当前故事仍存在——删了节点的旧档
    // 在读档时明确报错（reviveNode 抛），而非静默坏掉。args 递归解码后按值重绑。
    const rawArgs = (value as { args?: unknown }).args
    return reviveNode(v, Array.isArray(rawArgs) ? rawArgs.map((a) => decodeValue(a, reviveNode)) : undefined)
  }
  if (tag === 'obj' && v !== null && typeof v === 'object' && !Array.isArray(v)) return decodePlainFields(v as Record<string, unknown>, reviveNode) // 转义还原为普通对象
  return decodePlainFields(value as Record<string, unknown>, reviveNode) // 普通对象（无 __kin）、或 tag/载荷不匹配的 passthrough 值 → 当普通对象逐值 decode（降级，不崩）
}

function decodePlainFields(obj: Record<string, unknown>, reviveNode?: ReviveNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = decodeValue(v, reviveNode)
  return out
}
