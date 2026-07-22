import { plainText } from './spans'
import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { analyze } from '../analyze'
import { createStory, restoreStory } from './index'
import type { Story } from './story'

function prog(src: string) {
  const p = analyze([parse(src, 'main.kin')]).program
  if (!p) throw new Error('analyze 有 error，fixture 不合法')
  return p
}

function progMulti(files: { name: string; src: string }[]) {
  const p = analyze(files.map((f) => parse(f.src, f.name))).program
  if (!p) throw new Error('analyze 有 error，多文件 fixture 不合法')
  return p
}

function drainText(s: Story): string[] {
  const out: string[] = []
  while (s.canContinue) {
    const e = s.continue()
    if (e.kind === 'text') out.push(plainText(e.spans))
  }
  return out
}

/** JSON 往返一遍，模拟落盘读回。 */
function roundtrip(s: Story) {
  return JSON.parse(JSON.stringify(s.serialize()))
}

describe('Story 状态快照 —— 往返等价', () => {
  it('等待选择边界：serialize → JSON 往返 → restore 续读与不中断一致', () => {
    const src = ['=== A ===', '开场', '* 选一 -> B', '* 选二 -> C', '=== B ===', 'B正文', '-> END', '=== C ===', 'C正文', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['选一', '选二'])

    const snap = roundtrip(s)
    const r = restoreStory(program, snap)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s2 = r.story
    expect(s2.currentChoices.map((c) => plainText(c.spans))).toEqual(['选一', '选二'])

    s.choose(0)
    s2.choose(0)
    expect(drainText(s2)).toEqual(drainText(s))
  })

  it('嵌套 choice body 内选项（栈多层）往返等价', () => {
    const src = [
      '=== A ===',
      '* [外选一]',
      '> 进入外选一',
      '> * [内选一] -> B',
      '> * [内选二] -> C',
      '* [外选二] -> D',
      '=== B ===', 'B正文', '-> END',
      '=== C ===', 'C正文', '-> END',
      '=== D ===', 'D正文', '-> END',
    ].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['外选一', '外选二'])
    s.choose(0) // 进外选一 body
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['内选一', '内选二']) // 栈多层

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.story.currentChoices.map((c) => plainText(c.spans))).toEqual(['内选一', '内选二'])
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s))
  })

  it('已结束边界：restore 后 hasEnded 真、无选项', () => {
    const src = ['=== A ===', '只有一行', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.hasEnded).toBe(true)

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.story.hasEnded).toBe(true)
    expect(r.story.currentChoices).toEqual([])
  })

  it('rng 连续性：restore 后 random 续出与不中断一致', () => {
    const src = ['=== A ===', '骰{random(1,6)}{random(1,6)}{random(1,6)}', '* 再 -> A', '* 停 -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A', seed: 42 })
    drainText(s) // 第一轮骰子
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 第二轮骰子序列一致
  })

  it('变体计数跨快照：once 不重置不跳号', () => {
    const src = ['=== A ===', '{ once("甲","乙","丙") }', '* 再 -> A', '* 停 -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    expect(drainText(s)).toContain('甲') // 第一次
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 续读应出 '乙'，两边一致
  })

  it('指纹失配：改 program 后 restore 返回 fingerprint-mismatch', () => {
    const src = ['=== A ===', '* x -> END', '* y -> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    drainText(s)
    const snap = roundtrip(s)
    const other = prog(['=== A ===', '* x -> END'].join('\n')) // 删一个选项
    const r = restoreStory(other, snap)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('fingerprint-mismatch')
  })

  it('顶层开场选项（首个 === 前）：serialize → restore 往返等价（合成开场 knot）', () => {
    // 选项在 preamble（顶层开场），落进合成 ' opening:main.kin' knot——回归 buildBlockPaths/enumerateChoices 漏 opening 致「栈帧 block 无路径」。
    const src = ['开场正文', '* 选一 -> B', '* 选二 -> C', '=== B ===', 'B正文', '-> END', '=== C ===', 'C正文', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: ' opening:main.kin' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['选一', '选二'])

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.story.currentChoices.map((c) => plainText(c.spans))).toEqual(['选一', '选二'])
    s.choose(1)
    r.story.choose(1)
    expect(drainText(r.story)).toEqual(drainText(s))
  })

  it('非稳定边界 serialize 抛错', () => {
    const src = ['=== A ===', '第一行', '第二行', '-> END'].join('\n')
    const s = createStory(prog(src), { start: 'A' })
    expect(s.canContinue).toBe(true) // 有待 flush 文本，非稳定边界
    expect(() => s.serialize()).toThrow()
  })
})

// A2：park 态求值不重放——restore 直接用快照里的已求值结果，不重跑 enterChoiceGroup / evalArg。
// 旧实现 restore 末尾重跑 advanceToEvent 会把选项文本变体 / 条件 rng / placeholder 的副作用再施加一遍。
describe('Story 状态快照 —— A2 park 态求值不重放', () => {
  it('选项文本含 cycle：往返后选项文本与中断前一致（不漂移到下一变体）', () => {
    const src = ['=== A ===', '* 去{cycle("东","西","南")}边 -> B', '=== B ===', 'B正文', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['去东边'])

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 旧实现重跑 enterChoiceGroup → cycle 计数再进一格 → 「去西边」。修复后应保持「去东边」。
    expect(r.story.currentChoices.map((c) => plainText(c.spans))).toEqual(['去东边'])
  })

  it('选项条件含 random：往返后续骰序列与不中断直接续读一致', () => {
    const src = ['=== A ===', '* {random(1,100) > 0} 去 -> R', '=== R ===', '{random(1,6)}{random(1,6)}', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A', seed: 7 })
    drainText(s) // 到选项：condOk 消耗一次 rng
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    // 旧实现 restore 重跑 condOk 多耗一次 rng → 续骰序列错位。修复后两边一致。
    expect(drainText(r.story)).toEqual(drainText(s))
  })

  it('@input placeholder 含 cycle：往返后 placeholder 不变', () => {
    const src = ['=== A ===', '~ let name = ""', '@input(name, cycle("提示甲","提示乙"))', '你好{name}', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    while (s.canContinue) s.continue() // 推进到 @input park
    expect(s.currentInput?.placeholder).toBe('提示甲')

    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 旧实现 restore 重跑 evalArg → cycle 计数再进一格 → 「提示乙」。修复后保持「提示甲」。
    expect(r.story.currentInput?.placeholder).toBe('提示甲')
  })

  it('选项条件含非 rng 副作用（++全局）：往返后全局不被多加一次（方案 b 挡不住、方案 a 的存在理由）', () => {
    const src = ['~ let count = 0', '=== A ===', '* {++count > 0} 去 -> R', '=== R ===', 'count={count}', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s) // 到选项：condOk 令 count 0→1
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    // 旧实现 restore 重跑 condOk → ++计数 → 2；原故事为 1。修复后两边都为 1（且为「计数=1」）。
    expect(drainText(r.story)).toEqual(drainText(s))
  })
})

// A4：preamble/`~~~` 声明的函数经 JSON 落盘丢失，restore 必须重跑 buildGlobals 重建之。
describe('Story 状态快照 —— A4 函数重建', () => {
  it('preamble 声明的函数：往返后调用正常续读', () => {
    const src = ['~~~', 'function greet(n){ return "你好" + n }', '~~~', '=== A ===', '* 选 -> R', '=== R ===', '{greet("世界")}', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s))
  })

  it('在入口文件的开场 knot 内存档：往返后该文件 preamble 函数可用（buildGlobals 不得照搬 skipOpeningOf）', () => {
    // 起点是合成开场 knot，snapshot.current.knot === ' opening:main.kin'；若 restore 误用它作 skipOpeningOf，
    // 本文件 preamble 会被跳过、greet 不重建，choose 后调用即炸。
    const src = ['~~~', 'function greet(n){ return "你好" + n }', '~~~', '开场', '* 选 -> R', '=== R ===', '{greet("世界")}', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: ' opening:main.kin' })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s))
  })

  it('双次往返：从异文件 knot 存档的 restored 故事再存档，entry 不丢、二次读档仍不误抛', () => {
    // 存档点在 z.kin 的 B（≠ 入口 a.kin 的开场 knot）。restored 故事的 current.knot 是 'B'，
    // 若把它当 entry 再存档，二次读档丢失「a.kin preamble 最后跑」的顺序 → shared 未就绪误抛。
    const program = progMulti([
      { name: 'a.kin', src: ['~ let derived = shared + 1', '开场{derived}', '-> B'].join('\n') },
      { name: 'z.kin', src: ['~ let shared = 10', '=== B ===', 'B正文{derived}', '* 停 -> END'].join('\n') },
    ])
    const s = createStory(program, { start: ' opening:a.kin' })
    drainText(s)
    expect(s.currentChoices.map((c) => plainText(c.spans))).toEqual(['停'])
    const r1 = restoreStory(program, roundtrip(s))
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    // 从 restored 故事再存档（current.knot='B' ≠ entry），二次读档：旧 bug 下 entry 被写成 'B' → story-error。
    const r2 = restoreStory(program, roundtrip(r1.story))
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.story.currentChoices.map((c) => plainText(c.spans))).toEqual(['停'])
  })

  it('跨文件 preamble 读依赖：入口文件字典序靠前时，restore 仍与正常播放同序、不误抛 story-error', () => {
    // a.kin（入口开场 knot 起点）的 preamble 读 z.kin 声明的 shared；字典序 a<z。
    // 正常播放：buildGlobals 先跑 z.kin（shared=10）再由 enterKnot 跑 a.kin（derived=11）。
    // 若 restore 照字典序早跑 a.kin，shared 尚未就绪 → 抛错被误判 story-error（本用例锁 restore 复刻正常序）。
    const program = progMulti([
      { name: 'a.kin', src: ['~ let derived = shared + 1', '开场{derived}', '* 选 -> B'].join('\n') },
      { name: 'z.kin', src: ['~ let shared = 10', '=== B ===', 'B正文{derived}', '-> END'].join('\n') },
    ])
    const s = createStory(program, { start: ' opening:a.kin' })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true) // 旧序会走 story-error（shared 未就绪）；修复后正常
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s))
  })
})

// A12：restore 区分「存档数据坏（corrupt）」与「作者脚本坏（story-error）」，各带诊断。
describe('Story 状态快照 —— A12 错误分类', () => {
  it('坏存档（taken 序号越界）→ corrupt，detail 非空', () => {
    const src = ['=== A ===', '* x -> END', '* y -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    const snap = roundtrip(s)
    snap.taken = [999] // 越界序号 → 解码期抛错
    const r = restoreStory(program, snap)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('corrupt')
    if (r.reason === 'corrupt') expect(r.detail).toBeTruthy()
  })

  it('preamble 抛错的脚本 → story-error，message 含原始错误信息', () => {
    // 结构相同（指纹一致）、但 restore 用的 program preamble 会在构造期抛运行时错。
    const good = prog(['~ let x = 1', '=== A ===', '文本', '-> END'].join('\n'))
    const s = createStory(good, { start: 'A' })
    drainText(s)
    const snap = roundtrip(s)
    const bad = prog(['~ let x = null.foo', '=== A ===', '文本', '-> END'].join('\n'))
    const r = restoreStory(bad, snap)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('story-error')
    if (r.reason === 'story-error') expect(r.message).toContain('JS 执行错误')
  })

  it('version 1 / version 2 快照 → corrupt（只认 version 3）', () => {
    const program = prog(['=== A ===', '行', '-> END'].join('\n'))
    const s = createStory(program, { start: 'A' })
    drainText(s)
    for (const v of [1, 2]) {
      const snap = roundtrip(s)
      snap.version = v
      const r = restoreStory(program, snap)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('corrupt')
    }
  })
})

// T076：全局 / 局部作用域里的 Map/Set/Date 经存读档往返保真（白名单容器编解码）。
describe('Story 状态快照 —— T076 非 JSON 值保真', () => {
  it('全局 Map 往返保真：读档续跑累积状态不丢', () => {
    const src = ['~~~', 'let bag = new Map()', '~~~', '=== A ===', '~ bag.set("剑", 3)', '* 存 -> R', '=== R ===', '剑数{bag.get("剑")} 共{bag.size}', '-> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    // 旧（仅 T046）实现：Map 经 JSON 变 {}，读档后 bag.get 不是函数 → 抛错/丢数据。修复后续跑一致。
    expect(drainText(r.story)).toEqual(drainText(s))
    expect(drainText(s)).toEqual([]) // 原故事已 drain（内容为「剑数3 共1」）
  })

  it('全局 Set / Date 往返保真', () => {
    const src = [
      '~~~',
      'let seen = new Set()',
      'let t = new Date("2026-07-20T00:00:00.000Z")',
      '~~~',
      '=== A ===',
      '~ seen.add("东门")',
      '* 存 -> R',
      '=== R ===',
      '去过{seen.has("东门")} 年份{t.getUTCFullYear()}',
      '-> END',
    ].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 「去过true 年份2026」
  })

  it('局部作用域（current.locals）里的 Map 往返保真', () => {
    // knot A 局部声明 Map（inv 是 A 的局部，跨 knot 不可见）；停在其内选项时 current.locals 编码该 Map，
    // 读档还原后在选项体里读回——锁定 locals 也走编解码。
    const src = ['=== A ===', '~ let inv = new Map()', '~ inv.set("金", 5)', '* 存', '> 金{inv.get("金")}', '> -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    const r = restoreStory(program, roundtrip(s))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    s.choose(0)
    r.story.choose(0)
    expect(drainText(r.story)).toEqual(drainText(s)) // 「金5」
  })

  it('循环引用全局 → serialize 抛错（消息含变量名）', () => {
    const src = ['~~~', 'let bag = new Map()', 'bag.set("me", bag)', '~~~', '=== A ===', '文本', '* 停 -> END'].join('\n')
    const program = prog(src)
    const s = createStory(program, { start: 'A' })
    drainText(s)
    expect(() => s.serialize()).toThrow('循环引用')
  })
})
