import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'

const demoDir = join(dirname(fileURLToPath(import.meta.url)), '../../public/demo')

describe('内置 demo 项目', () => {
  it('analyze 零 error 且能建出 Story', () => {
    const manifest = readFileSync(join(demoDir, 'kiny.json'), 'utf8')
    const index = JSON.parse(readFileSync(join(demoDir, 'files.json'), 'utf8')) as string[]
    const files = new Map(index.map((p) => [p, readFileSync(join(demoDir, p), 'utf8')]))

    const res = loadProjectFromFiles(manifest, files)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { program, diagnostics } = analyze(res.files)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(program).not.toBeNull()
    const start = resolveStart(program!, res.entry)
    expect(start).not.toBeNull()
    expect(createStory(program!, { start: start! }).canContinue).toBe(true)
  })

  it('引用的资源文件都存在且非空', () => {
    for (const a of ['harbor_fog.jpg', 'tavern_interior.jpg', 'ambient_fog.mp3']) {
      const p = join(demoDir, 'assets', a)
      expect(existsSync(p), `${a} 应存在`).toBe(true)
      expect(readFileSync(p).length, `${a} 应非空`).toBeGreaterThan(0)
    }
  })
})
