import { describe, it, expect } from 'vitest'
import { ACTION_NAMES } from './actions'
import { TOOL_DEFINITIONS } from './toolDefinitions'

describe('动作层 tool-definitions', () => {
  it('一一覆盖动作层全部命令', () => {
    const defNames = TOOL_DEFINITIONS.map((d) => d.name).sort()
    expect(defNames).toEqual([...ACTION_NAMES].sort())
  })

  it('每个定义有非空 description 与 object schema', () => {
    for (const d of TOOL_DEFINITIONS) {
      expect(d.description.length).toBeGreaterThan(0)
      expect((d.parameters as { type?: string }).type).toBe('object')
    }
  })

  it('无参命令的 properties 为空、required 缺省或空', () => {
    const listProject = TOOL_DEFINITIONS.find((d) => d.name === 'listProject')!
    const props = (listProject.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toHaveLength(0)
  })

  it('带参命令列出参数与 required（writeFile / replaceRange 抽查）', () => {
    const writeFile = TOOL_DEFINITIONS.find((d) => d.name === 'writeFile')!
    const wfProps = (writeFile.parameters as { properties: Record<string, unknown> }).properties
    const wfReq = (writeFile.parameters as { required?: string[] }).required ?? []
    expect(wfProps).toHaveProperty('path')
    expect(wfProps).toHaveProperty('source')
    expect(wfReq).toEqual(expect.arrayContaining(['path', 'source']))

    const replaceRange = TOOL_DEFINITIONS.find((d) => d.name === 'replaceRange')!
    const rrProps = (replaceRange.parameters as { properties: Record<string, { type?: string }> }).properties
    expect(rrProps.start.type).toBe('integer')
    expect(rrProps.end.type).toBe('integer')
  })

  it('可选参数不进 required（getDiagnostics.path 可选）', () => {
    const gd = TOOL_DEFINITIONS.find((d) => d.name === 'getDiagnostics')!
    const req = (gd.parameters as { required?: string[] }).required ?? []
    expect(req).not.toContain('path')
  })

  it('包含 listKinSpec / readKinSpec，readKinSpec 必填 id', () => {
    const names = TOOL_DEFINITIONS.map((d) => d.name)
    expect(names).toContain('listKinSpec')
    expect(names).toContain('readKinSpec')
    const rk = TOOL_DEFINITIONS.find((d) => d.name === 'readKinSpec')!
    const req = (rk.parameters as { required?: string[] }).required ?? []
    expect(req).toContain('id')
  })
})
