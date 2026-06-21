import type { SourceLine } from './source'
import { splitLines } from './source'
import { parseKnotHeader, parseStitchHeader } from './declarations'
import { ParseError } from './errors'

/** pass 1 的子节点骨架：body 为原始行 */
export interface StitchSkeleton {
  name: string
  body: SourceLine[]
  line: number
}

/** pass 1 的节点骨架：body 为原始行，子节点为骨架 */
export interface KnotSkeleton {
  name: string
  params: string[]
  body: SourceLine[]
  stitches: StitchSkeleton[]
  line: number
}

/** pass 1 的文件骨架 */
export interface FileSkeleton {
  path: string
  preamble: SourceLine[]
  knots: KnotSkeleton[]
}

/**
 * pass 1 · 结构趟：把已去注释的文件文本解析成 FileSkeleton。
 * 正文行保持原始 SourceLine，不解析其内部内容（留给块趟 / 行内趟）。
 * 声明级语法错误以 ParseError 抛出，并带上文件路径。
 */
export function parseStructure(text: string, path: string): FileSkeleton {
  const preamble: SourceLine[] = []
  const knots: KnotSkeleton[] = []
  let currentKnot: KnotSkeleton | null = null
  let currentStitch: StitchSkeleton | null = null

  for (const sl of splitLines(text)) {
    const t = sl.text.trim()

    if (t.startsWith('=')) {
      let lead = 0
      while (lead < t.length && t[lead] === '=') lead++
      try {
        if (lead === 1) {
          if (!currentKnot) {
            throw new ParseError('子节点必须位于某个节点内部，但此处还没有任何节点', sl.line)
          }
          const name = parseStitchHeader(t, sl.line)
          currentStitch = { name, body: [], line: sl.line }
          currentKnot.stitches.push(currentStitch)
        } else {
          const header = parseKnotHeader(t, sl.line)
          currentKnot = {
            name: header.name,
            params: header.params,
            body: [],
            stitches: [],
            line: sl.line,
          }
          currentStitch = null
          knots.push(currentKnot)
        }
      } catch (e) {
        if (e instanceof ParseError) {
          throw new ParseError(e.message, e.line, path)
        }
        throw e
      }
      continue
    }

    if (currentStitch) {
      currentStitch.body.push(sl)
    } else if (currentKnot) {
      currentKnot.body.push(sl)
    } else {
      preamble.push(sl)
    }
  }

  return { path, preamble, knots }
}
