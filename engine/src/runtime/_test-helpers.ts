import { parse } from '../parser'
import { analyze, resolveStart } from '../analyze'
import { createStory } from './index'
import type { OutputEvent } from './types'
import { plainText } from './spans'

/** 建 Story：parse → analyze → createStory（start 默认首 knot 名）。 */
export function story(src: string, start?: string) {
  const program = analyze([parse(src, 'main.kin')]).program
  if (!program) throw new Error('analyze 有 error，fixture 不合法')
  const startKnot = start ?? program.files[0]!.knots[0]!.name
  return createStory(program, { start: startKnot })
}

/** 从「入口解析」起跑（开场 knot 或第一个显式 knot），用于测开场节点行为。 */
export function storyFromEntry(src: string, path = 'main.kin') {
  const program = analyze([parse(src, path)]).program
  if (!program) throw new Error('analyze 有 error，fixture 不合法')
  const start = resolveStart(program, path)
  if (start === null) throw new Error('无可运行入口')
  return createStory(program, { start })
}

/** 把 Story 跑到不能推进，收集 text/command 事件（无选择脚本）。 */
export function drain(s: ReturnType<typeof story>): OutputEvent[] {
  const out: OutputEvent[] = []
  while (s.canContinue) out.push(s.continue())
  return out
}

/** drain 后取所有 text 事件的纯文本字符串。 */
export function texts(s: ReturnType<typeof story>): string[] {
  return drain(s).flatMap((e) => (e.kind === 'text' ? [plainText(e.spans)] : []))
}

/** 跑到选项点，返回此前文本；按 script 依次 choose；收集全程文本。 */
export function play(s: ReturnType<typeof story>, script: number[]): { texts: string[]; choices: string[][] } {
  const texts: string[] = []
  const choices: string[][] = []
  let si = 0
  for (;;) {
    while (s.canContinue) {
      const e: OutputEvent = s.continue()
      if (e.kind === 'text') texts.push(plainText(e.spans))
    }
    if (s.currentChoices.length > 0) {
      choices.push(s.currentChoices.map((c) => plainText(c.spans)))
      if (si >= script.length) break
      s.choose(script[si++]!)
    } else break
  }
  return { texts, choices }
}
