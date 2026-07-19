import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * T071 守卫：源码不得含**原始 NUL 字节**（`0x00`）。见 engine/src/no-raw-nul.test.ts
 * 的说明——原始 NUL 会让 ripgrep 把文件判为二进制、内容搜索静默跳过。
 */
// 锚定包根的 src（npm 跑包脚本时 cwd = 包目录）。见 engine 同名测试的说明。
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
  it('editor/src 下无源码文件含 0x00', () => {
    const offenders = walk(SRC).filter((f) => readFileSync(f).includes(0))
    expect(offenders).toEqual([])
  })
})
