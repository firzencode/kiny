import { describe, it, expect } from 'vitest'
import { parse, ParseError } from './index'
import type { ProjectFile, ContentElement, TextLine, ChoiceGroup, Conditional } from './index'

describe('parse —— 冒烟', () => {
  it('串起四趟：注释剥离 + 结构 + 折叠 + 行内', () => {
    const src = ['~ let gold = 10', '=== 开场 ===', '你有{gold}金币 // 旁白', '-> END'].join('\n')
    const file = parse(src, 'main.kin')
    expect(file.path).toBe('main.kin')
    expect(file.preamble).toEqual([{ kind: 'logicLine', code: 'let gold = 10', line: 1 }])
    expect(file.knots.map((k) => k.name)).toEqual(['开场'])
    const body = file.knots[0]!.body
    expect(body[0]!.kind).toBe('text')
    expect(body[1]).toEqual({ kind: 'divert', target: 'END', args: [], line: 4 })
  })
})

const FOG = [
  '// 雾港之夜 - main.kin',
  '',
  '~ let gold = 10',
  '~ let has_lantern = false',
  '~ let met_innkeeper = 0',
  '',
  '=== 雾港开场 ===',
  '@bg_show("harbor_fog.jpg")',
  '@bgm_play("ambient_fog.mp3")',
  '',
  '雾从港口涌上来，遮住了路灯。',
  '你站在码头边，{has_lantern ? "灯笼的光在雾中划出一圈昏黄" : "四周一片漆黑"}。',
  '',
  '* [走向客栈] -> 客栈',
  '* [沿码头继续走] -> 码头',
  '* {!has_lantern} [回家拿灯笼] -> 回家',
  '',
  '=== 客栈 ===',
  '@bg_show("tavern_interior.jpg")',
  '',
  '老板抬起头看着你。',
  '',
  '@if {met_innkeeper === 0}',
  '> 这是你第一次见他。',
  '@else',
  '> 你和他点了点头。',
  '~ met_innkeeper++',
  '',
  '"想要点什么？"',
  '',
  '* {gold >= 5} [买一杯酒（5 金币）]',
  '> ~ gold -= 5',
  '> 你接过酒杯，喝了一口。',
  '> -> 客栈',
  '* {gold >= 20 && !has_lantern} [买灯笼（20 金币）]',
  '> ~ gold -= 20',
  '> ~ has_lantern = true',
  '> 你接过灯笼，点亮了它。',
  '> -> 客栈',
  '* [离开客栈] -> 雾港开场',
  '',
  '=== 码头 ===',
  '雾里传来汽笛声。{ shuffle("远处", "更远处", "不知道哪里") }。',
  '-> END',
  '',
  '=== 回家 ===',
  '你回到家，拿了灯笼。',
  '~ has_lantern = true',
  '-> 雾港开场',
].join('\n')

/** 收集整棵 AST 里所有 interp 段的 id。 */
function collectInterpIds(file: ProjectFile): number[] {
  const ids: number[] = []
  const walkText = (t: TextLine): void => {
    for (const s of t.segments) if (s.kind === 'interp') ids.push(s.id)
  }
  const walkBlock = (block: ContentElement[]): void => {
    for (const el of block) {
      if (el.kind === 'text') walkText(el)
      else if (el.kind === 'choiceGroup') {
        for (const c of el.choices) {
          for (const seg of [...c.before, ...(c.inner ?? []), ...c.after]) {
            if (seg.kind === 'interp') ids.push(seg.id)
          }
          walkBlock(c.body)
        }
      } else if (el.kind === 'conditional') {
        for (const b of el.branches) walkBlock(b.body)
      }
    }
  }
  walkBlock(file.preamble)
  for (const k of file.knots) {
    walkBlock(k.body)
    for (const s of k.stitches) walkBlock(s.body)
  }
  return ids
}

describe('parse —— §14 雾港之夜端到端', () => {
  const file = parse(FOG, 'main.kin')
  const knot = (name: string) => file.knots.find((k) => k.name === name)!

  it('preamble 是三条变量声明逻辑行', () => {
    expect(file.preamble).toEqual([
      { kind: 'logicLine', code: 'let gold = 10', line: 3 },
      { kind: 'logicLine', code: 'let has_lantern = false', line: 4 },
      { kind: 'logicLine', code: 'let met_innkeeper = 0', line: 5 },
    ])
  })

  it('四个节点齐全', () => {
    expect(file.knots.map((k) => k.name)).toEqual(['雾港开场', '客栈', '码头', '回家'])
  })

  it('雾港开场：命令 + 含三元插值的文本 + 三选项', () => {
    const body = knot('雾港开场').body
    expect(body[0]).toMatchObject({ kind: 'command', name: 'bg_show', args: ['"harbor_fog.jpg"'] })
    expect(body[1]).toMatchObject({ kind: 'command', name: 'bgm_play' })
    const interpText = body.find(
      (el): el is TextLine => el.kind === 'text' && el.segments.some((s) => s.kind === 'interp'),
    )!
    expect(interpText.segments.some((s) => s.kind === 'interp' && s.code.includes('has_lantern ?'))).toBe(true)
    const group = body.find((el): el is ChoiceGroup => el.kind === 'choiceGroup')!
    expect(group.choices).toHaveLength(3)
    expect(group.choices[0]!.inner).toEqual([{ kind: 'literal', value: '走向客栈' }])
    expect(group.choices[0]!.resultDivert).toMatchObject({ target: '客栈' })
    expect(group.choices[2]!.condition).toBe('!has_lantern')
  })

  it('客栈：@if/@else 链 + 汇合逻辑行 + 买酒选项体', () => {
    const body = knot('客栈').body
    const cond = body.find((el): el is Conditional => el.kind === 'conditional')!
    expect(cond.branches.map((b) => b.condition)).toEqual(['met_innkeeper === 0', null])
    expect(body.some((el) => el.kind === 'logicLine' && el.code === 'met_innkeeper++')).toBe(true)
    const group = body.find((el): el is ChoiceGroup => el.kind === 'choiceGroup')!
    const buy = group.choices[0]!
    expect(buy.condition).toBe('gold >= 5')
    expect(buy.body[0]).toMatchObject({ kind: 'logicLine', code: 'gold -= 5' })
    expect(buy.body[buy.body.length - 1]).toMatchObject({ kind: 'divert', target: '客栈' })
  })

  it('码头：含 shuffle 变体插值的文本 + -> END', () => {
    const body = knot('码头').body
    const text = body[0] as TextLine
    expect(text.kind).toBe('text')
    expect(text.segments.some((s) => s.kind === 'interp' && s.code.includes('shuffle('))).toBe(true)
    expect(body[body.length - 1]).toMatchObject({ kind: 'divert', target: 'END' })
  })

  it('所有 interp 节点 id 互不重复', () => {
    const ids = collectInterpIds(file)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parse —— 错误透传', () => {
  it('深层未闭合 { 经 parse 抛带行号与路径的 ParseError', () => {
    const src = ['=== A ===', '* [选项]', '> 你有{gold 金币'].join('\n')
    try {
      parse(src, 'main.kin')
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).path).toBe('main.kin')
      expect((e as ParseError).line).toBe(3)
    }
  })
})
