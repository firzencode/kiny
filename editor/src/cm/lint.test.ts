import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Diagnostic as KinDiagnostic } from '@kiny/engine'
import { toCmDiagnostics } from './lint'

const doc = (s: string) => EditorState.create({ doc: s }).doc
const diag = (line: number, over: Partial<KinDiagnostic> = {}): KinDiagnostic => ({
  severity: 'error', code: 'x', message: 'm', file: 'main.kin', line, ...over,
})

describe('toCmDiagnostics（engine 诊断 → CM6 整行波浪线）', () => {
  it('一条诊断映射成目标行的整行 span', () => {
    const d = doc('第一行\n第二行\n第三行')
    const [cm] = toCmDiagnostics([diag(2)], d)
    const l = d.line(2)
    expect(cm.from).toBe(l.from)
    expect(cm.to).toBe(l.to)
    expect(cm.severity).toBe('error')
  })

  it('保留 message / severity / code(source)', () => {
    const d = doc('a\nb')
    const [cm] = toCmDiagnostics([diag(1, { severity: 'warning', message: '重复节点', code: 'duplicate-knot' })], d)
    expect(cm.message).toBe('重复节点')
    expect(cm.severity).toBe('warning')
    expect(cm.source).toBe('duplicate-knot')
  })

  it('越界行号被跳过、不抛', () => {
    const d = doc('only one line')
    expect(toCmDiagnostics([diag(5), diag(0), diag(-1)], d)).toEqual([])
  })

  it('多条诊断按 from 升序排列', () => {
    const d = doc('l1\nl2\nl3')
    const out = toCmDiagnostics([diag(3), diag(1), diag(2)], d)
    expect(out.map((c) => c.from)).toEqual([...out.map((c) => c.from)].sort((a, b) => a - b))
    expect(out).toHaveLength(3)
  })
})
