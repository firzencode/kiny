import type { SourceLine } from './source'
import { splitLevel } from './levels'
import { ParseError } from './errors'
import type { FileSkeleton } from './structure'
import type { RawBlock, RawChoice, RawBranch, RawFile } from './rawblock'

const AT_COND = /^@(if|elif|else)(?![A-Za-z0-9_])/

// 可变游标：递归调用借此推进共享的扁平行数组位置（而非返回新位置）。
interface Cursor {
  i: number
}

function isBlank(text: string): boolean {
  return text.trim() === ''
}

/** 折叠恰好属于 level 的连续行；遇更低层级返回（汇合到外层）。 */
function foldAtLevel(lines: SourceLine[], cur: Cursor, level: number, path: string): RawBlock {
  const block: RawBlock = []
  while (true) {
    while (cur.i < lines.length && isBlank(lines[cur.i]!.text)) cur.i += 1
    if (cur.i >= lines.length) break

    const sl = lines[cur.i]!
    const { level: lv, content } = splitLevel(sl.text)
    if (lv < level) break
    if (lv > level) {
      throw new ParseError('> 层级跳跃：该行缺少上一层的选项或 @if 开启者', sl.line, path)
    }

    const first = content[0]

    if (first === '*' || first === '+') {
      cur.i += 1
      const choice: RawChoice = {
        sticky: first === '+',
        raw: content.slice(1).replace(/^\s+/, ''),
        body: foldAtLevel(lines, cur, level + 1, path),
        line: sl.line,
      }
      // 相邻同层选项合并进已开启的选项组，而非新开一组（单趟解析，block 无其它引用，原地改安全）
      const last = block[block.length - 1]
      if (last && last.kind === 'choiceGroup') {
        last.choices.push(choice)
      } else {
        block.push({ kind: 'choiceGroup', choices: [choice], line: sl.line })
      }
      continue
    }

    const condMatch = AT_COND.exec(content)
    if (condMatch) {
      const selector = condMatch[1]! as 'if' | 'elif' | 'else'
      cur.i += 1
      const branch: RawBranch = {
        selector,
        raw: content.slice(condMatch[0]!.length).replace(/^\s+/, ''),
        body: foldAtLevel(lines, cur, level + 1, path),
        line: sl.line,
      }
      if (selector === 'if') {
        block.push({ kind: 'conditional', branches: [branch], line: sl.line })
      } else {
        // elif/else 追加到紧邻的上一条 conditional；中间隔了别的元素则 last 非 conditional → 报错
        const last = block[block.length - 1]
        if (!last || last.kind !== 'conditional') {
          throw new ParseError(`@${selector} 前没有同层的 @if`, sl.line, path)
        }
        const branches = last.branches
        if (branches[branches.length - 1]!.selector === 'else') {
          throw new ParseError(`@else 之后不能再有 @${selector}`, sl.line, path)
        }
        branches.push(branch)
      }
      continue
    }

    if (content === '~~~') {
      if (level !== 0) {
        throw new ParseError('~~~ 多行块只能在节点/子节点正文顶层，不能嵌在分支体内', sl.line, path)
      }
      const startLine = sl.line
      cur.i += 1
      const codeLines: string[] = []
      let closed = false
      let endLine = startLine
      while (cur.i < lines.length) {
        const bl = lines[cur.i]!
        cur.i += 1
        if (bl.text.trim() === '~~~') {
          closed = true
          endLine = bl.line
          break
        }
        codeLines.push(bl.text)
      }
      if (!closed) {
        throw new ParseError('~~~ 块未闭合', startLine, path)
      }
      block.push({ kind: 'logicBlock', code: codeLines.join('\n'), line: startLine, endLine })
      continue
    }

    cur.i += 1
    if (content.startsWith('~')) {
      block.push({ kind: 'logicLine', code: content.slice(1).replace(/^\s+/, ''), line: sl.line })
    } else if (content.startsWith('->')) {
      block.push({ kind: 'divert', raw: content, line: sl.line })
    } else if (content.startsWith('@')) {
      block.push({ kind: 'command', raw: content, line: sl.line })
    } else {
      block.push({ kind: 'text', raw: content, line: sl.line })
    }
  }
  return block
}

/** pass 2 核心：把一段 body 的 SourceLine[] 折叠成 RawBlock。 */
export function foldBlock(lines: SourceLine[], path: string): RawBlock {
  return foldAtLevel(lines, { i: 0 }, 0, path)
}

/** 把 pass 1 的 FileSkeleton 整体折叠成 RawFile。 */
export function foldFile(file: FileSkeleton): RawFile {
  return {
    path: file.path,
    preamble: foldBlock(file.preamble, file.path),
    knots: file.knots.map((k) => ({
      name: k.name,
      params: k.params,
      body: foldBlock(k.body, file.path),
      stitches: k.stitches.map((s) => ({
        name: s.name,
        body: foldBlock(s.body, file.path),
        line: s.line,
      })),
      line: k.line,
    })),
  }
}
