import { parse as acornParse } from 'acorn'
import type { Rng } from './rng'

const VARIANT_NAMES = new Set(['seq', 'cycle', 'once', 'shuffle'])
type N = any

/** 给片段里每个变体调用插一个稳定 site-id 作首实参。fragKey 用于使 id 跨片段唯一。 */
export function tagVariants(code: string, fragKey: string): string {
  let program: N
  try {
    program = acornParse(code, { ecmaVersion: 'latest' })
  } catch {
    return code
  }
  const inserts: { pos: number; id: string }[] = []
  let counter = 0
  const walk = (node: N): void => {
    if (!node || typeof node.type !== 'string') return
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      VARIANT_NAMES.has(node.callee.name)
    ) {
      const id = `${fragKey}#${counter++}`
      const parenPos = code.indexOf('(', node.callee.end)
      inserts.push({ pos: parenPos + 1, id })
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue
      const v = node[k]
      if (Array.isArray(v)) for (const c of v) walk(c)
      else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(program)
  if (inserts.length === 0) return code
  inserts.sort((a, b) => b.pos - a.pos) // 从后往前插，偏移不乱
  let out = code
  for (const ins of inserts) {
    const arg = JSON.stringify(ins.id) + (peekNonSpace(out, ins.pos) === ')' ? '' : ',')
    out = out.slice(0, ins.pos) + arg + out.slice(ins.pos)
  }
  return out
}

function peekNonSpace(s: string, from: number): string {
  let i = from
  while (i < s.length && /\s/.test(s[i]!)) i++
  return s[i] ?? ''
}

type VariantFn = (...a: unknown[]) => string

/** makeVariants 产物：内置函数 fns（装配进作用域 B）+ 计数器 export/import（状态快照用）。 */
export interface Variants {
  fns: { seq: VariantFn; cycle: VariantFn; once: VariantFn; shuffle: VariantFn }
  exportCounters(): Record<string, number>
  importCounters(rec: Record<string, number>): void
}

/** 4 个变体内置：首参为 site-id，按 id 维护计数器（counters 闭包持久，跨经过累积）。 */
export function makeVariants(rng: Rng): Variants {
  const counters = new Map<string, number>()
  const bump = (id: string): number => {
    const n = counters.get(id) ?? 0
    counters.set(id, n + 1)
    return n
  }
  return {
    fns: {
      seq: (id: unknown, ...items: unknown[]) =>
        String(items[Math.min(bump(String(id)), items.length - 1)] ?? ''),
      cycle: (id: unknown, ...items: unknown[]) =>
        String(items[bump(String(id)) % items.length] ?? ''),
      once: (id: unknown, ...items: unknown[]) => {
        const i = bump(String(id))
        return i < items.length ? String(items[i] ?? '') : ''
      },
      shuffle: (id: unknown, ...items: unknown[]) => {
        bump(String(id))
        return String(items[Math.floor(rng.next() * items.length)] ?? '')
      },
    },
    exportCounters: () => Object.fromEntries(counters),
    importCounters: (rec) => {
      counters.clear()
      for (const [k, v] of Object.entries(rec)) counters.set(k, v)
    },
  }
}
