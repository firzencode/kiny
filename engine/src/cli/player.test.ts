import { describe, it, expect } from 'vitest'
import { play } from './player'
import { storyFromEntry } from '../runtime/_test-helpers'
import type { Term } from './term'

function fakeTerm(answers: string[] = []): Term & { out: string[] } {
  const out: string[] = []
  let i = 0
  return {
    color: false,
    out,
    write: (s) => { out.push(s) },
    readLine: async () => answers[i++] ?? 'q',
  }
}

const CHOICE_SRC = ['选择：', '* [左] -> L', '* [右] -> R', '=== L ===', '左。', '-> END', '=== R ===', '右。', '-> END'].join('\n')

describe('cli play 循环', () => {
  it('纯文本零-knot：逐行输出后结束', async () => {
    const term = fakeTerm()
    const r = await play(storyFromEntry('第一行。\n第二行。'), term)
    expect(r).toBe('ended')
    expect(term.out).toEqual(['第一行。', '第二行。', '—— 故事结束 ——'])
  })
  it('命令打印为 » 标注行（关颜色即纯文本）', async () => {
    const term = fakeTerm()
    await play(storyFromEntry('@bg_show("a.jpg")\n你好。\n-> END'), term)
    expect(term.out).toEqual(['» bg_show(a.jpg)', '你好。', '—— 故事结束 ——'])
  })
  it('选项编号呈现，输入数字推进', async () => {
    const term = fakeTerm(['1'])
    const r = await play(storyFromEntry(CHOICE_SRC), term)
    expect(r).toBe('ended')
    expect(term.out).toContain('选择：')
    expect(term.out).toContain('  1) 左')
    expect(term.out).toContain('  2) 右')
    expect(term.out).toContain('左。')
  })
  it('非法输入重提示，再有效输入', async () => {
    const term = fakeTerm(['9', 'abc', '1'])
    await play(storyFromEntry(CHOICE_SRC), term)
    expect(term.out.filter((l) => l === '请输入 1..2 或 q')).toHaveLength(2)
    expect(term.out).toContain('左。')
  })
  it('q 退出返回 quit', async () => {
    const term = fakeTerm(['q'])
    const r = await play(storyFromEntry(CHOICE_SRC), term)
    expect(r).toBe('quit')
  })
})
