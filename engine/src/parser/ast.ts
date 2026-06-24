/** 内联富文本样式：标签栈扁平化后挂在 literal / interp 段上的当前样式快照。无样式时整体省略。 */
export interface InlineStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** `#rgb` / `#rrggbb` / 字母构成的 CSS 具名色；非法值不落（诊断另出）。 */
  color?: string
  /** 相对正文字号的正数倍数；非法值不落（诊断另出）。 */
  size?: number
}

/**
 * 行内片段：
 * - `literal` 字面文本（转义已还原），可带富文本 `style`；
 * - `interp` `{ JS 表达式 }` 插值（带变体计数用的稳定 id），可带富文本 `style`；
 * - `break` 显式换行 `<br>`（自闭合，无文本）。
 * 无标签的纯文本不带 `style` 字段——向后兼容既有故事。
 */
export type InlineSegment =
  | { kind: 'literal'; value: string; style?: InlineStyle }
  | { kind: 'interp'; code: string; id: number; style?: InlineStyle }
  | { kind: 'break' }

/** 一处内联富文本问题：未闭合 / 错配标签、非法颜色 / 字号值。由 scanInline 收集、analyze 转诊断。 */
export interface RichTextIssue {
  code: 'rich-unclosed' | 'rich-mismatch' | 'rich-bad-color' | 'rich-bad-size'
  message: string
  line: number
}

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
  /** 本文件全部内联富文本问题（文档序），analyze 转 error 级诊断。无问题为空数组。 */
  richTextIssues: RichTextIssue[]
}
