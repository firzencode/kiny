import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { run } from './run'
import type { Term } from './term'

const samplePath = fileURLToPath(new URL('../../../samples/雾港之夜', import.meta.url))

function fakeTerm(answers: string[]): Term & { out: string[] } {
  const out: string[] = []
  let i = 0
  return { color: false, out, write: (s) => { out.push(s) }, readLine: async () => answers[i++] ?? 'q' }
}

describe('§14 雾港之夜 e2e —— 终端跑通', () => {
  it('开场播命令+文本，冒充者(seed 1)直接交图 → 为渊驱鱼 → END', async () => {
    // 出发前 3)推门 → 酒馆闲谈 4)开始盘问 → 盘问(未收集线索)1)交出设计图。
    const term = fakeTerm(['3', '4', '1'])
    const code = await run([samplePath, '--seed', '1'], term)
    expect(code).toBe(0)
    expect(term.out[0]).toBe('雾港之夜')
    expect(term.out).toContain('» bg_show(assets/harbor_fog.jpg)')
    expect(term.out).toContain('» bgm_play(assets/ambient_fog.mp3)')
    expect(term.out).toContain('末班蒸汽船把你卸在雾港的栈桥上，锅炉的余温还贴在背后，转眼就被夜雾吞了。')
    expect(term.out).toContain('  3) 收好东西，推开锈锚酒馆的门')
    expect(term.out).toContain('  4) 收起寒暄，开始盘问')
    // 未收集线索 → 盘问无核验选项，只剩交/不交
    expect(term.out).toContain('  1) 把铜管推过去——交出设计图')
    // seed 1 = 冒充者：交图落到「为渊驱鱼」结局
    expect(term.out.some((l) => l.includes('设计图到了不该到的手里'))).toBe(true)
    expect(term.out[term.out.length - 1]).toBe('—— 故事结束 ——')
  })
})
