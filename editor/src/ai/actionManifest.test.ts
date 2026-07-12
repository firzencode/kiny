import { describe, it, expect } from 'vitest'
import { ACTION_MANIFEST, manifestToJsonSchema } from './actionManifest'
import { ACTION_NAMES } from './actions'

describe('ACTION_MANIFEST', () => {
  it('覆盖 ACTION_NAMES 全集且不多不少', () => {
    const names = ACTION_MANIFEST.map((c) => c.name).sort()
    expect(names).toEqual([...ACTION_NAMES].sort())
  })
  it('命令名无重复', () => {
    const names = ACTION_MANIFEST.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
  it('manifestToJsonSchema：必填进 required、可选不进', () => {
    const gd = ACTION_MANIFEST.find((c) => c.name === 'getDiagnostics')!
    const schema = manifestToJsonSchema(gd)
    expect(schema.properties.path.type).toBe('string')
    expect('required' in schema).toBe(false) // getDiagnostics.path 可选 → 无 required
    const wf = manifestToJsonSchema(ACTION_MANIFEST.find((c) => c.name === 'writeFile')!)
    expect(wf.required).toEqual(['path', 'source'])
  })
  it('内容型参数恰为 writeFile.source / insertText.text / replaceRange.text，submitInput.text 不算', () => {
    const contentParams = ACTION_MANIFEST.flatMap((c) =>
      Object.entries(c.params).filter(([, p]) => p.content).map(([k]) => `${c.name}.${k}`),
    )
    expect(contentParams.sort()).toEqual(['insertText.text', 'replaceRange.text', 'writeFile.source'])
    const si = ACTION_MANIFEST.find((c) => c.name === 'submitInput')!
    expect(si.params.text.content).toBeUndefined()
  })
})
