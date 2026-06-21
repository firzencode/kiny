/** 行内片段：字面文本（转义已还原）或 { JS 表达式 } 插值（带变体计数用的稳定 id）。 */
export type InlineSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'interp'; code: string; id: number }

export interface TextLine {
  kind: 'text'
  segments: InlineSegment[]
  glue: boolean
  line: number
}

export interface Divert {
  kind: 'divert'
  target: string
  args: string[]
  line: number
}

export interface ChoiceGroup {
  kind: 'choiceGroup'
  choices: Choice[]
  line: number
}

export interface Choice {
  sticky: boolean
  fallback: boolean
  condition: string | null
  label: string | null
  before: InlineSegment[]
  inner: InlineSegment[] | null
  after: InlineSegment[]
  resultDivert: Divert | null
  body: ContentBlock
  line: number
}

export interface Conditional {
  kind: 'conditional'
  branches: ConditionalBranch[]
  line: number
}

export interface ConditionalBranch {
  condition: string | null
  body: ContentBlock
  line: number
}

export interface LogicLine {
  kind: 'logicLine'
  code: string
  line: number
}

export interface LogicBlock {
  kind: 'logicBlock'
  code: string
  line: number
  endLine: number
}

export interface Command {
  kind: 'command'
  name: string
  args: string[]
  line: number
}

export type ContentElement =
  | TextLine
  | Divert
  | ChoiceGroup
  | Conditional
  | LogicLine
  | LogicBlock
  | Command

export type ContentBlock = ContentElement[]

export interface Knot {
  kind: 'knot'
  name: string
  params: string[]
  body: ContentBlock
  stitches: Stitch[]
  line: number
  /** 'global' = 合成开场 knot（作用域为全局）；普通 knot 不设（=局部）。 */
  scope?: 'global'
}

export interface Stitch {
  kind: 'stitch'
  name: string
  body: ContentBlock
  line: number
}

export interface ProjectFile {
  path: string
  preamble: ContentElement[]
  knots: Knot[]
}
