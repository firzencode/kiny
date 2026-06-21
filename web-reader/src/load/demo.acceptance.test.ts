import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { initialState, advance, choose, type PlayState, type ResolveAsset } from '@kiny/player'

// 验收：用强制种子驱动内置 demo《雾港之夜》，覆盖设计稿 §7——
// 四结局（身份 × 决断）、伪造陷阱（验符印不给信号）、知识门控（未收集则核验选项不出现）。
// 种子由探针确定：seed 0 → 真灰隼(imposter=0)，seed 1 → 冒充者(imposter=1)。
const SEED_REAL = 0
const SEED_IMPOSTER = 1

const demoDir = join(dirname(fileURLToPath(import.meta.url)), '../../public/demo')
const RESOLVE: ResolveAsset = (name) => 'demo/' + name

function build(seed: number): Story {
  const manifest = readFileSync(join(demoDir, 'kiny.json'), 'utf8')
  const index = JSON.parse(readFileSync(join(demoDir, 'files.json'), 'utf8')) as string[]
  const files = new Map(index.map((p) => [p, readFileSync(join(demoDir, p), 'utf8')]))
  const res = loadProjectFromFiles(manifest, files)
  if (!res.ok) throw new Error('load: ' + res.errors.map((e) => e.message).join(';'))
  const { program } = analyze(res.files)
  if (!program) throw new Error('analyze failed')
  const start = resolveStart(program, res.entry)
  if (start === null) throw new Error('no start')
  return createStory(program, { start, seed })
}

/** 一次游玩：建 Story、推进到首个选项，后续靠 click 按选项文案前进。 */
function playthrough(seed: number) {
  const story = build(seed)
  let state: PlayState = advance(story, initialState, RESOLVE).state
  return {
    get state() {
      return state
    },
    /** 当前可见选项文案（按引擎顺序）。 */
    labels() {
      return state.choices.map((c) => c.text)
    },
    /** 按文案子串选中一个选项并推进；找不到即报错。 */
    click(sub: string) {
      const c = state.choices.find((c) => c.text.includes(sub))
      if (!c) throw new Error(`无选项含「${sub}」，现有：${state.choices.map((c) => c.text).join(' | ')}`)
      state = choose(story, state, c.index, RESOLVE).state
      expect(state.error, '驱动中不应出错').toBeNull()
      return this
    },
    /** 已结束时，最后一条叙述文本（用于辨结局）。 */
    ending() {
      expect(state.ended, '应已抵达结局').toBe(true)
      const narr = state.log.filter((e) => e.kind === 'narration')
      return (narr[narr.length - 1] as { text: string }).text
    },
    /** 全部叙述拼接（用于检查结局风味句是否出现）。 */
    prose() {
      return state.log
        .filter((e): e is { kind: 'narration'; text: string } => e.kind === 'narration')
        .map((e) => e.text)
        .join('\n')
    },
  }
}

describe('demo 验收 · 雾港之夜', () => {
  describe('四结局 = 身份 × 决断', () => {
    it('真灰隼 + 交出 → 送达（圆满）', () => {
      const p = playthrough(SEED_REAL)
        .click('推开锈锚酒馆的门').click('开始盘问').click('交出设计图')
      expect(p.ending()).toContain('你交对了人')
    })

    it('真灰隼 + 拒交 → 错付（苦涩）', () => {
      const p = playthrough(SEED_REAL)
        .click('推开锈锚酒馆的门').click('开始盘问').click('起身离座')
      expect(p.ending()).toContain('那确是真灰隼')
    })

    it('冒充者 + 交出 → 为渊驱鱼（最坏）', () => {
      const p = playthrough(SEED_IMPOSTER)
        .click('推开锈锚酒馆的门').click('开始盘问').click('交出设计图')
      expect(p.ending()).toContain('到了不该到的手里')
    })

    it('冒充者 + 拒交 → 雾里识隼（惊险）', () => {
      const p = playthrough(SEED_IMPOSTER)
        .click('推开锈锚酒馆的门').click('开始盘问').click('起身离座')
      expect(p.ending()).toContain('设计图没有泄露出去')
    })
  })

  describe('伪造陷阱：验符印不给信号', () => {
    // 只验符印 → suspicion 不增 → 为渊驱鱼结局不出现「疑点」风味句。
    it('冒充者只验符印交图，结局无「疑点」追述', () => {
      const p = playthrough(SEED_IMPOSTER)
        .click('翻开那本简易魔法手册') // 解锁 know_seal
        .click('推开锈锚酒馆的门').click('开始盘问')
        .click('验那枚符印') // 唯一核验：符印两边都泛灰光、不加 suspicion
        .click('交出设计图')
      expect(p.ending()).toContain('到了不该到的手里')
      expect(p.prose()).not.toContain('那些疑点你不是没看见')
    })

    // 对照：问来路(定性核验) → suspicion 增 → 同结局出现「疑点」风味句。
    it('冒充者问来路后交图，结局出现「疑点」追述', () => {
      const p = playthrough(SEED_IMPOSTER)
        .click('摊开随身的地图') // 解锁 know_geo
        .click('推开锈锚酒馆的门').click('开始盘问')
        .click('怎么来雾港') // 定性核验：露破绽 → suspicion++
        .click('交出设计图')
      expect(p.prose()).toContain('那些疑点你不是没看见')
    })
  })

  describe('知识门控：核验选项靠收集解锁', () => {
    it('未收集线索 → 盘问只剩交/不交，无核验选项', () => {
      const p = playthrough(SEED_REAL)
        .click('推开锈锚酒馆的门').click('开始盘问')
      const labels = p.labels()
      expect(labels.some((t) => t.includes('交出设计图'))).toBe(true)
      expect(labels.some((t) => t.includes('起身离座'))).toBe(true)
      expect(labels.some((t) => t.includes('怎么来雾港'))).toBe(false)
      expect(labels.some((t) => t.includes('验那枚符印'))).toBe(false)
    })

    it('看过地图 → 盘问解锁「问来路」', () => {
      const p = playthrough(SEED_REAL)
        .click('摊开随身的地图')
        .click('推开锈锚酒馆的门').click('开始盘问')
      expect(p.labels().some((t) => t.includes('怎么来雾港'))).toBe(true)
    })
  })
})
