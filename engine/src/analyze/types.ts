import type { ProjectFile, Knot, Stitch } from '../parser/ast'

export type Severity = 'error' | 'warning'

/** 一条诊断：错误或警告，带 1 起行号与文件路径。 */
export interface Diagnostic {
  severity: Severity
  code: string
  message: string
  file: string
  line: number
}

/** 声明 / 引用的作用域：全局（preamble）或某节点局部。 */
export type Scope = { kind: 'global' } | { kind: 'knot'; name: string }

/** 一处 let/const/function 顶层声明名的出现（带定位）。 */
export interface DeclSite {
  name: string
  file: string
  line: number
  scope: Scope
}

/** 一处选项标签 (label) 的出现。 */
export interface LabelSite {
  name: string
  file: string
  line: number
}

/** 一处节点参数名的出现（行号用节点声明行）。 */
export interface ParamSite {
  name: string
  file: string
  line: number
  knot: string
}

/** 一个 JS 片段经 acorn 分析后的结果：自由引用 + 语法错误（二者互斥）。 */
export interface FragmentInfo {
  file: string
  line: number
  scope: Scope
  references: string[]
  syntaxError: string | null
}

/** 跨文件符号表：纯数据，由 buildSymbolTable 产出，各 check 只读。 */
export interface SymbolTable {
  knots: Map<string, Knot>
  stitches: Map<string, Map<string, Stitch>>
  declarations: DeclSite[]
  labels: LabelSite[]
  params: ParamSite[]
  fragments: FragmentInfo[]
  // 派生的快速查询集
  globals: Set<string>
  locals: Map<string, Set<string>>
  labelSet: Set<string>
}

export interface ValidatedProgram {
  files: ProjectFile[]
  knots: Map<string, Knot>
  stitches: Map<string, Map<string, Stitch>>
  globals: Set<string>
  locals: Map<string, Set<string>>
  labels: Set<string>
}

export interface AnalyzeResult {
  program: ValidatedProgram | null
  diagnostics: Diagnostic[]
}
