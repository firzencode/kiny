import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { run } from './run'
import type { Term } from './term'

const fx = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))

function fakeTerm(answers: string[] = []): Term & { out: string[] } {
  const out: string[] = []
  let i = 0
  return { color: false, out, write: (s) => { out.push(s) }, readLine: async () => answers[i++] ?? 'q' }
}

describe('cli run 编排', () => {
  it('缺 kiny.json → 打印错误，退出码 1', async () => {
    const term = fakeTerm()
    const code = await run([fx('no-manifest')], term)
    expect(code).toBe(1)
    expect(term.out.some((l) => l.includes('kiny.json'))).toBe(true)
  })
  it('analyze 有 error → 打印诊断，退出码 1', async () => {
    const term = fakeTerm()
    const code = await run([fx('analyze-error')], term)
    expect(code).toBe(1)
    expect(term.out.some((l) => l.startsWith('error'))).toBe(true)
  })
  it('正常项目 → 标题先行、打印正文，退出码 0', async () => {
    const term = fakeTerm()
    const code = await run([fx('ok')], term)
    expect(code).toBe(0)
    expect(term.out[0]).toBe('测试项目')
    expect(term.out).toContain('正文')
  })
  it('--seed 在路径前也能正确取项目目录', async () => {
    const term = fakeTerm()
    const code = await run(['--seed', '1', fx('ok')], term)
    expect(code).toBe(0)
    expect(term.out[0]).toBe('测试项目')
  })
})
