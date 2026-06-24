import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory } from './index'
import type { OutputEvent } from './types'

const FOG = [
  '~ let gold = 10',
  '~ let has_lantern = false',
  '~ let met_innkeeper = 0',
  '=== 雾港开场 ===',
  '@bg_show("harbor_fog.jpg")',
  '雾从港口涌上来。',
  '* [走向客栈] -> 客栈',
  '* [沿码头继续走] -> 码头',
  '=== 客栈 ===',
  '老板抬起头。',
  '@if {met_innkeeper === 0}',
  '> 第一次见他。',
  '@else',
  '> 点点头。',
  '~ met_innkeeper++',
  '* {gold >= 5} [买酒]',
  '> ~ gold -= 5',
  '> 你喝了一口。',
  '> -> 客栈',
  '* [离开] -> 雾港开场',
  '=== 码头 ===',
  '雾里传来汽笛声。',
  '-> END',
].join('\n')

/** 跑一段选择脚本，产出确定性 trace 行；可指定入口节点与 PRNG 种子。 */
function trace(src: string, script: number[], opts: { start?: string; seed?: number } = {}): string[] {
  const program = analyze([parse(src, 'main.kin')]).program!
  const s = createStory(program, { start: opts.start ?? '雾港开场', seed: opts.seed })
  const lines: string[] = []
  let si = 0
  for (;;) {
    while (s.canContinue) {
      const e: OutputEvent = s.continue()
      if (e.kind === 'text') lines.push(`T ${plainText(e.spans)}`)
      else lines.push(`C ${e.name}(${e.args.map(String).join(',')})`)
    }
    if (s.currentChoices.length > 0) {
      lines.push('? ' + s.currentChoices.map((c) => plainText(c.spans)).join(' | '))
      if (si >= script.length) break
      s.choose(script[si++]!)
    } else break
  }
  return lines
}

describe('runtime 集成 —— 确定性最小 trace', () => {
  // 脚本 [0,0,0,0]：走向客栈 → 买酒（回客栈）→ 离开（回开场）→ 沿码头 → END。
  // 一次性 `*` 选项选过即排除（spec §165）：二访客栈仅余「离开」、重入开场仅余「沿码头继续走」。
  // 节点重入（离开→回开场）重跑正文，故 @bg_show 命令再次产出。
  it('黄金 trace [0,0,0,0]', () => {
    expect(trace(FOG, [0, 0, 0, 0])).toEqual([
      'C bg_show(harbor_fog.jpg)', // 开场入口：命令硬边界，先于文本产出
      'T 雾从港口涌上来。',
      '? 走向客栈 | 沿码头继续走', // 两选项均无条件
      'T 老板抬起头。', // 进客栈
      'T 第一次见他。', // @if met_innkeeper===0（真），met++ → 1
      '? 买酒 | 离开', // gold=10≥5 买酒可见
      'T 你喝了一口。', // 买酒体：~ gold-=5（10→5）→ 文本 → -> 客栈
      'T 老板抬起头。', // 重入客栈
      'T 点点头。', // @else（met=1≠0），met++ → 2
      '? 离开', // 买酒为一次性已选 → 排除，仅余离开
      'C bg_show(harbor_fog.jpg)', // 离开 → 重入开场：正文重跑，命令重放
      'T 雾从港口涌上来。',
      '? 沿码头继续走', // 走向客栈为一次性已选 → 排除
      'T 雾里传来汽笛声。', // 码头 → -> END
    ])
  })
})

// 含 random() + shuffle() 的故事：固定种子 → 锁定整条随机路径（端到端「同种子同 trace」）。
// 开局 random(1,6) 抽骰子；鸣笛节点每访一次 shuffle 一句，粘性 `+` 选项循环三访走满一个 shuffle 周期。
const VARIANTS = [
  '~ let dice = random(1, 6)',
  '~ let beats = 0',
  '=== 雾号 ===',
  '今夜骰子 {dice} 点。',
  '-> 鸣笛',
  '=== 鸣笛 ===',
  '雾里一声：{ shuffle("近处", "远处", "更远处") }。',
  '~ beats++',
  '+ {beats < 3} [再听一声] -> 鸣笛',
  '* [够了，走] -> 散场',
  '=== 散场 ===',
  '雾渐渐散了。',
  '-> END',
].join('\n')

describe('runtime 集成 —— 随机路径黄金 trace（固定种子）', () => {
  // 脚本 [0,0,0]：连选「再听一声」三次（粘性选项跨访持存），beats 满 3 后该选项被条件门控隐去，余「够了，走」→ 散场 → END。
  // seed 5 下：random(1,6) 抽出 5；shuffle 一个周期内三选项各出一次，洗成「更远处 → 近处 → 远处」（非源序，证明确在洗牌）。
  it('seed 5 黄金 trace [0,0,0]', () => {
    expect(trace(VARIANTS, [0, 0, 0], { start: '雾号', seed: 5 })).toEqual([
      'T 今夜骰子 5 点。', // random(1,6) → 5（固定种子下确定）
      'T 雾里一声：更远处。', // shuffle 周期第 1 抽
      '? 再听一声 | 够了，走', // beats=1<3，粘性选项可见
      'T 雾里一声：近处。', // shuffle 周期第 2 抽
      '? 再听一声 | 够了，走', // beats=2<3
      'T 雾里一声：远处。', // shuffle 周期第 3 抽（一个周期三选项各一次）
      '? 够了，走', // beats=3，{beats<3} 假 → 再听隐去
      'T 雾渐渐散了。', // 够了 → 散场 → END
    ])
  })

  // 同种子必同 trace（可复现性）；不传种子时回退默认种子，与显式默认种子一致。
  it('同一种子两次运行结果一致', () => {
    const a = trace(VARIANTS, [0, 0, 0], { start: '雾号', seed: 5 })
    const b = trace(VARIANTS, [0, 0, 0], { start: '雾号', seed: 5 })
    expect(a).toEqual(b)
  })
})
