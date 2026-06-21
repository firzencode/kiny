export type RawBlock = RawElement[]

export type RawElement =
  | RawText
  | RawDivert
  | RawCommand
  | RawLogicLine
  | RawLogicBlock
  | RawChoiceGroup
  | RawConditional

export interface RawText {
  kind: 'text'
  raw: string
  line: number
}

export interface RawDivert {
  kind: 'divert'
  raw: string
  line: number
}

export interface RawCommand {
  kind: 'command'
  raw: string
  line: number
}

export interface RawLogicLine {
  kind: 'logicLine'
  code: string
  line: number
}

export interface RawLogicBlock {
  kind: 'logicBlock'
  code: string
  line: number
  endLine: number
}

export interface RawChoiceGroup {
  kind: 'choiceGroup'
  choices: RawChoice[]
  line: number
}

export interface RawChoice {
  sticky: boolean
  raw: string
  body: RawBlock
  line: number
}

export interface RawConditional {
  kind: 'conditional'
  branches: RawBranch[]
  line: number
}

export interface RawBranch {
  selector: 'if' | 'elif' | 'else'
  raw: string
  body: RawBlock
  line: number
}

export interface RawFile {
  path: string
  preamble: RawBlock
  knots: RawKnot[]
}

export interface RawKnot {
  name: string
  params: string[]
  body: RawBlock
  stitches: RawStitch[]
  line: number
}

export interface RawStitch {
  name: string
  body: RawBlock
  line: number
}
