import { describe, it, expect } from 'vitest'
import { story, texts, play } from './_test-helpers'
import { RuntimeError } from './types'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory, restoreStory } from './index'
import { plainText } from './spans'

describe('动态跳转 -> {表达式} —— $nodes 引用档', () => {
  it('引用存变量后动态跳 knot', () => {
    const s = story(['=== A ===', '~ let t = $nodes.B', '-> {t}', '=== B ===', '到了', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['到了'])
    expect(s.hasEnded).toBe(true)
  })

  it('动态跳 stitch（全路径引用）', () => {
    const s = story(['=== A ===', '~ let t = $nodes.B.s', '-> {t}', '=== B ===', '-> END', '= s', '内部', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['内部'])
  })

  it('数据驱动：map 里挑引用跳转', () => {
    const s = story([
      '=== A ===',
      '~ let map1 = { 北: $nodes.走廊, 南: $nodes.大厅 }',
      '~ let dir = "南"',
      '-> {map1[dir]}',
      '=== 走廊 ===', '走廊里', '-> END',
      '=== 大厅 ===', '大厅里', '-> END',
    ].join('\n'))
    expect(texts(s)).toEqual(['大厅里'])
  })

  it('$nodes.END 引用跳转 ≡ -> END', () => {
    const s = story(['=== A ===', '~ let t = $nodes.END', '早退', '-> {t}', '不该出现'].join('\n'))
    expect(texts(s)).toEqual(['早退'])
    expect(s.hasEnded).toBe(true)
  })

  it('带参节点：绑参引用跳转实参生效（创建时求值）', () => {
    const s = story([
      '=== A ===',
      '~ let n = 1',
      '~ let task = $nodes.商店("灯笼", n)',
      '~ n = 99',
      '-> {task}',
      '=== 商店(item, num) ===', '{item}:{num}', '-> END',
    ].join('\n'))
    expect(texts(s)).toEqual(['灯笼:1']) // n 后改不影响创建时已求值的实参
  })

  it('未绑定实参的带参节点引用直接跳是运行时错误', () => {
    const s = story(['=== A ===', '~ let t = $nodes.商店', '-> {t}', '=== 商店(item) ===', '-> END'].join('\n'))
    expect(() => texts(s)).toThrow(/绑定实参/)
  })

  it('引用可先流转再绑参（f = $nodes.X 后 f(...)）', () => {
    const s = story([
      '=== A ===', '~ let f = $nodes.商店', '~ let t = f("酒")', '-> {t}',
      '=== 商店(item) ===', '{item}', '-> END',
    ].join('\n'))
    expect(texts(s)).toEqual(['酒'])
  })

  it('访问不存在的节点在访问行当场抛（计算下标绕过编译期检查，运行时防线兜底）', () => {
    const s = story(['=== A ===', '~ let k = "不存在"', '~ let t = $nodes[k]', '-> END'].join('\n'))
    expect(() => texts(s)).toThrow(/节点不存在/)
  })
})

describe('动态跳转 —— 字符串档', () => {
  it('字符串按 knot 名查表跳转', () => {
    const s = story(['=== A ===', '~ let t = "B"', '-> {t}', '=== B ===', '字串到达', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['字串到达'])
  })

  it('字符串全路径 "父.子" 跳 stitch', () => {
    const s = story(['=== A ===', '~ let t = "B.s"', '-> {t}', '=== B ===', '-> END', '= s', '子内容', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['子内容'])
  })

  it('"END" / "DONE" 字符串生效', () => {
    const s = story(['=== A ===', '~ let t = "END"', '完', '-> {t}', '不该出现'].join('\n'))
    expect(texts(s)).toEqual(['完'])
    expect(s.hasEnded).toBe(true)
  })

  it('裸 stitch 名不做同级相对解析（即使同级存在也拒）', () => {
    const s = story(['=== A ===', '~ let t = "s"', '-> {t}', '= s', '同级子', '-> END'].join('\n'))
    expect(() => texts(s)).toThrow(/节点不存在：「s」/)
  })

  it('查不到抛「节点不存在」', () => {
    const s = story(['=== A ===', '~ let t = "乌有乡"', '-> {t}'].join('\n'))
    expect(() => texts(s)).toThrow(/节点不存在：「乌有乡」/)
  })

  it('字符串目标是带参 knot 抛（须经 $nodes 绑参）', () => {
    const s = story(['=== A ===', '~ let t = "商店"', '-> {t}', '=== 商店(item) ===', '-> END'].join('\n'))
    expect(() => texts(s)).toThrow(/绑定实参/)
  })
})

describe('动态跳转 —— 拒跳与防线', () => {
  it('非引用非字符串值拒跳', () => {
    const s = story(['=== A ===', '~ let t = 42', '-> {t}'].join('\n'))
    expect(() => texts(s)).toThrow(/跳转目标须是 \$nodes 引用或节点名字符串/)
  })

  it('undefined 拒跳', () => {
    const s = story(['=== A ===', '~ let t = null', '-> {t}'].join('\n'))
    expect(() => texts(s)).toThrow(RuntimeError)
  })

  it('带参 knot 的 stitch 外部禁入（引用档运行时防线）', () => {
    const s = story([
      '=== A ===', '~ let t = $nodes["商店.密室"]', '-> {t}',
      '=== 商店(item) ===', '-> END', '= 密室', '{item}', '-> END',
    ].join('\n'))
    expect(() => texts(s)).toThrow(/不能从外部跳进带参节点/)
  })

  it('带参 knot 内动态跳自己的 stitch 合法（参数保留）', () => {
    const s = story([
      '=== A ===', '-> 商店("刀")',
      '=== 商店(item) ===', '~ let t = $nodes["商店.里间"]', '-> {t}', '= 里间', '{item}', '-> END',
    ].join('\n'))
    expect(texts(s)).toEqual(['刀'])
  })
})

describe('动态跳转 —— 语义完整性', () => {
  it('选项 resultDivert 动态目标', () => {
    const s = story([
      '=== A ===',
      '~ let dest = $nodes.B',
      '* [走] -> {dest}',
      '=== B ===', '走到了', '-> END',
    ].join('\n'))
    const r = play(s, [0])
    expect(r.texts).toContain('走到了')
  })

  it('fallback 动态目标', () => {
    const s = story([
      '=== A ===',
      '~ let back1 = $nodes.B',
      '* {false} [不可见] -> END',
      '* -> {back1}',
      '=== B ===', '退到这', '-> END',
    ].join('\n'))
    expect(texts(s)).toEqual(['退到这'])
  })

  it('访问计数与变体不受动态跳转影响（turns_since 记到访问）', () => {
    const s = story([
      '=== A ===', '~ let t = $nodes.B', '-> {t}',
      '=== B ===', '{turns_since("B") === 0 ? "刚到" : "不对"}', '-> END',
    ].join('\n'))
    expect(texts(s)).toEqual(['刚到'])
  })

  it('glue 跨动态跳转', () => {
    const s = story(['=== A ===', '~ let t = $nodes.B', '前半<>', '-> {t}', '=== B ===', '后半', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['前半后半'])
  })

  it('Object.keys($nodes) 可枚举 knot 名服务配置表', () => {
    const s = story(['=== A ===', '{Object.keys($nodes).join(",")}', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['A'])
  })

  it('插值 {引用} 打印完整路径', () => {
    const s = story(['=== A ===', '~ let t = $nodes.B.s', '目标:{t}', '-> END', '=== B ===', '-> END', '= s', '-> END'].join('\n'))
    expect(texts(s)).toEqual(['目标:B.s'])
  })
})

describe('动态跳转 —— 存读档（Node 标签集成）', () => {
  const SRC = [
    '=== A ===',
    '~ let back1 = $nodes.B',
    '~ let task = $nodes.商店("酒", 2)',
    '* [去商店] -> {task}',
    '* [回去] -> {back1}',
    '=== B ===', '回到了', '-> END',
    '=== 商店(item, num) ===', '{item}x{num}', '-> END',
  ].join('\n')

  function build(src = SRC) {
    const program = analyze([parse(src, 'main.kin')]).program
    if (!program) throw new Error('fixture 不合法')
    return { program, story: createStory(program, { start: 'A' }) }
  }

  it('全局里的引用（含绑参）经存读档往返后仍可动态跳转', () => {
    const { program, story: s } = build()
    while (s.canContinue) s.continue()
    expect(s.currentChoices.length).toBe(2)
    const snap = JSON.parse(JSON.stringify(s.serialize()))
    const r = restoreStory(program, snap)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    r.story.choose(0) // 去商店：绑参引用读档后仍带实参
    const out: string[] = []
    while (r.story.canContinue) {
      const e = r.story.continue()
      if (e.kind === 'text') out.push(plainText(e.spans))
    }
    expect(out).toContain('酒x2')
  })

  it('存档引用的节点被删 → restore 判 corrupt（明确报错）', () => {
    const { story: s } = build()
    while (s.canContinue) s.continue()
    const snap = JSON.parse(JSON.stringify(s.serialize()))
    // 同一 fingerprint 骗不过：直接篡改快照里 Node 标签指向不存在的节点，模拟「节点已删」。
    const globals = snap.globals as Record<string, unknown>
    globals['back1'] = { __kin: 'Node', v: '已删除' }
    const { program: sameProgram } = build()
    const r = restoreStory(sameProgram, snap)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('corrupt')
  })
})
