import type { Story } from '../runtime'
import type { Term } from './term'

const ESC = '\x1b['

/** 播放循环：canContinue 就 continue 打印（命令打成淡色 » 行），遇选项编号呈现并读输入，直到 END 或用户 q。 */
export async function play(story: Story, term: Term): Promise<'ended' | 'quit'> {
  const dim = (s: string) => (term.color ? `${ESC}2m${s}${ESC}0m` : s)
  for (;;) {
    while (story.canContinue) {
      const e = story.continue()
      if (e.kind === 'text') term.write(e.text)
      else term.write(dim(`» ${e.name}(${e.args.map(String).join(', ')})`))
    }
    if (story.hasEnded) {
      term.write('—— 故事结束 ——')
      return 'ended'
    }
    const cs = story.currentChoices
    if (cs.length === 0) return 'ended'
    cs.forEach((c, i) => term.write(`  ${i + 1}) ${c.text}`))
    for (;;) {
      const ans = (await term.readLine('> ')).trim()
      if (ans === 'q' || ans === 'quit') return 'quit'
      const n = Number(ans)
      if (Number.isInteger(n) && n >= 1 && n <= cs.length) {
        story.choose(cs[n - 1]!.index)
        break
      }
      term.write(`请输入 1..${cs.length} 或 q`)
    }
  }
}
