import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * T071 守卫：源码不得含**原始 NUL 字节**（`0x00`）。
 * 用 NUL 当分隔符要写转义 `'\u0000'`，而非把原始控制字节嵌进源码——后者会让
 * ripgrep/grep 把文件判为二进制、内容搜索静默跳过（2026-07-17 审计误判「全仓无
 * new Function」即因 env.ts/layout.ts 各藏一个原始 NUL 而漏检）。
 */
// 锚定包根的 src（npm 跑包脚本时 cwd = 包目录）。不用 import.meta.url——editor
// 的 vitest 里它非 file: scheme，fileURLToPath 会抛。
const SRC = join(process.cwd(), 'src')
const SKIP = new Set(['node_modules', 'dist', 'generated'])
const EXT = /\.(ts|tsx|js|mjs|cjs|css|json|html)$/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

describe('源码不含原始 NUL 字节（T071）', () => {
  it('engine/src 下无源码文件含 0x00', () => {
    const offenders = walk(SRC).filter((f) => readFileSync(f).includes(0))
    expect(offenders).toEqual([])
  })
})
