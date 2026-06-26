/**
 * engine 诊断 → CM6 `@codemirror/lint` 诊断的映射。
 *
 * engine 的 `Diagnostic` 只有 `line`（1 起）、无 column（见 docs/memory/cm6-spike-findings.md），
 * 故一条诊断画成**整行** span `[line.from, line.to]`，用 `doc.line(n)` 直取。
 * 越界行号（文件刚被改短等竞态）跳过，不抛。
 */
import type { Text } from '@codemirror/state'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { Diagnostic as KinDiagnostic } from '@kiny/engine'

/** 把当前活动文件的 engine 诊断映射成 CM6 诊断（整行波浪线）。 */
export function toCmDiagnostics(diags: readonly KinDiagnostic[], doc: Text): CmDiagnostic[] {
  const out: CmDiagnostic[] = []
  for (const d of diags) {
    if (d.line < 1 || d.line > doc.lines) continue // 行号越界：跳过
    const line = doc.line(d.line)
    out.push({
      from: line.from,
      to: line.to,
      severity: d.severity, // 'error' | 'warning' 与 CM6 同名
      message: d.message,
      source: d.code,
    })
  }
  // CM6 要求诊断按 from 升序。
  out.sort((a, b) => a.from - b.from)
  return out
}
