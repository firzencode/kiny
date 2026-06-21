import type { ProjectFile, ContentBlock } from '../../parser/ast'
import type { Diagnostic } from '../types'
import { COMMAND_NAMES } from '../constants'

/** 未知 @命令。 */
export function checkCommands(files: ProjectFile[]): Diagnostic[] {
  const out: Diagnostic[] = []
  const walk = (block: ContentBlock, file: string) => {
    for (const el of block) {
      switch (el.kind) {
        case 'command':
          if (!COMMAND_NAMES.has(el.name)) {
            out.push({ severity: 'error', code: 'unknown-command', message: `未知命令：@${el.name}`, file, line: el.line })
          }
          break
        case 'choiceGroup':
          for (const c of el.choices) walk(c.body, file)
          break
        case 'conditional':
          for (const b of el.branches) walk(b.body, file)
          break
      }
    }
  }
  for (const file of files) {
    walk(file.preamble, file.path)
    for (const knot of file.knots) {
      walk(knot.body, file.path)
      for (const st of knot.stitches) walk(st.body, file.path)
    }
  }
  return out
}
