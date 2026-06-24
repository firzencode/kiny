import { scanInline, splitInlineDivert } from './inline'
import { parseDivert, parseCommand } from './args'
import { parseChoice } from './choice'
import { findInterpEnd } from './interp'
import { ParseError } from './errors'
import type {
  ProjectFile,
  Knot,
  Stitch,
  ContentBlock,
  ContentElement,
  Divert,
  Choice,
  ChoiceGroup,
  Conditional,
  ConditionalBranch,
  InlineSegment,
  RichTextIssue,
} from './ast'
import type { RawFile, RawBlock, RawChoice, RawChoiceGroup, RawConditional, RawBranch, RawKnot, RawStitch } from './rawblock'

/**
 * pass 3 收尾：把 RawFile 转成最终 ProjectFile。
 * 闭包内 nextId 单调线程化变体 id（文档序）；文本/选项区跑 scanInline、
 * divert 跑 parseDivert、命令跑 parseCommand、@if/@elif 取 {cond}、
 * 选项组校验 ≤1 fallback。
 */
export function transform(file: RawFile): ProjectFile {
  const path = file.path
  let nextId = 0
  const richTextIssues: RichTextIssue[] = []

  function scanText(text: string, line: number): { segments: InlineSegment[]; glue: boolean } {
    const r = scanInline(text, nextId, line, path)
    nextId = r.nextId
    if (r.issues.length > 0) richTextIssues.push(...r.issues)
    return { segments: r.segments, glue: r.glue }
  }

  function toDivert(raw: string, line: number): Divert {
    const d = parseDivert(raw, line, path)
    return { kind: 'divert', target: d.target, args: d.args, line }
  }

  function transformBranch(b: RawBranch): ConditionalBranch {
    let condition: string | null
    if (b.selector === 'else') {
      if (b.raw.trim() !== '') {
        throw new ParseError('@else 不接受条件或多余内容', b.line, path)
      }
      condition = null
    } else {
      const raw = b.raw.trim()
      if (!raw.startsWith('{')) {
        throw new ParseError(`@${b.selector} 缺少条件 {}`, b.line, path)
      }
      const end = findInterpEnd(raw, 0)
      if (end === -1) {
        throw new ParseError(`@${b.selector} 条件 { 未闭合`, b.line, path)
      }
      if (raw.slice(end).trim() !== '') {
        throw new ParseError(`@${b.selector} 条件后有多余内容`, b.line, path)
      }
      // findInterpEnd 返回 } 之后的下标，故 slice(1, end-1) 去掉首尾花括号取出条件
      condition = raw.slice(1, end - 1).trim()
      if (condition === '') {
        throw new ParseError(`@${b.selector} 条件为空`, b.line, path)
      }
    }
    return { condition, body: transformBlock(b.body), line: b.line }
  }

  function transformConditional(c: RawConditional): Conditional {
    return { kind: 'conditional', branches: c.branches.map(transformBranch), line: c.line }
  }

  function transformChoice(rc: RawChoice): Choice {
    const p = parseChoice(rc.raw, rc.line, path)
    const before = scanText(p.before, rc.line).segments
    const inner = p.inner === null ? null : scanText(p.inner, rc.line).segments
    const after = scanText(p.after, rc.line).segments
    const resultDivert = p.divert === null ? null : toDivert(p.divert, rc.line)
    const body = transformBlock(rc.body)
    return {
      sticky: rc.sticky,
      fallback: p.fallback,
      condition: p.condition,
      label: p.label,
      before,
      inner,
      after,
      resultDivert,
      body,
      line: rc.line,
    }
  }

  function transformChoiceGroup(g: RawChoiceGroup): ChoiceGroup {
    const choices = g.choices.map(transformChoice)
    if (choices.filter((c) => c.fallback).length > 1) {
      throw new ParseError('一组选项内只能有一个 fallback（* -> 目标）', g.line, path)
    }
    return { kind: 'choiceGroup', choices, line: g.line }
  }

  function transformBlock(block: RawBlock): ContentBlock {
    const out: ContentElement[] = []
    for (const el of block) {
      switch (el.kind) {
        case 'text': {
          const split = splitInlineDivert(el.raw)
          const { segments, glue } = scanText(split.text, el.line)
          out.push({ kind: 'text', segments, glue, line: el.line })
          if (split.divert !== null) {
            out.push(toDivert(split.divert, el.line))
          }
          break
        }
        case 'divert':
          out.push(toDivert(el.raw, el.line))
          break
        case 'command': {
          const c = parseCommand(el.raw, el.line, path)
          out.push({ kind: 'command', name: c.name, args: c.args, line: el.line })
          break
        }
        case 'logicLine':
          out.push({ kind: 'logicLine', code: el.code, line: el.line })
          break
        case 'logicBlock':
          out.push({ kind: 'logicBlock', code: el.code, line: el.line, endLine: el.endLine })
          break
        case 'choiceGroup':
          out.push(transformChoiceGroup(el))
          break
        case 'conditional':
          out.push(transformConditional(el))
          break
      }
    }
    return out
  }

  function transformStitch(s: RawStitch): Stitch {
    return { kind: 'stitch', name: s.name, body: transformBlock(s.body), line: s.line }
  }

  function transformKnot(k: RawKnot): Knot {
    return {
      kind: 'knot',
      name: k.name,
      params: k.params,
      body: transformBlock(k.body),
      stitches: k.stitches.map(transformStitch),
      line: k.line,
    }
  }

  const preamble = transformBlock(file.preamble)
  const knots = file.knots.map(transformKnot)
  return { path, preamble, knots, richTextIssues }
}
