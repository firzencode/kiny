import type { ProjectFile } from '../parser/ast'
import type { AnalyzeResult, Diagnostic, ValidatedProgram } from './types'
import { buildSymbolTable } from './symbols'
import { checkNames } from './checks/names'
import { checkCommands } from './checks/commands'
import { checkDiverts } from './checks/diverts'
import { checkIdentifiers } from './checks/identifiers'
import { checkLabels } from './checks/labels'
import { checkVariables } from './checks/variables'
import { checkFallthrough } from './checks/fallthrough'
import { checkRichText } from './checks/richtext'
import { checkMissingChoiceMarker } from './checks/missing-choice-marker'
import { addOpeningKnots } from './opening'

export type { Diagnostic, AnalyzeResult, ValidatedProgram } from './types'
export { openingKnotName, resolveStart } from './opening'

/** 语义检查总入口：建符号表 → 跑全部检查 → 产出 program 或诊断集。 */
export function analyze(files: ProjectFile[]): AnalyzeResult {
  const table = buildSymbolTable(files)
  addOpeningKnots(table.knots, files) // 合成开场 knot 进 knots Map（program.knots = table.knots）

  const diagnostics: Diagnostic[] = [
    ...checkNames(files),
    ...checkCommands(files),
    ...checkDiverts(files, table),
    ...checkIdentifiers(table),
    ...checkLabels(table),
    ...checkVariables(table),
    ...checkFallthrough(files),
    ...checkRichText(files),
    ...checkMissingChoiceMarker(files),
  ]

  const hasError = diagnostics.some((d) => d.severity === 'error')
  const program: ValidatedProgram | null = hasError
    ? null
    : {
        files,
        knots: table.knots,
        stitches: table.stitches,
        globals: table.globals,
        locals: table.locals,
        labels: table.labelSet,
      }

  return { program, diagnostics }
}
