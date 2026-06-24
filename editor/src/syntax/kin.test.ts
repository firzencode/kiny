import { describe, it, expect } from 'vitest'
import { tokenizeLine, parseNodes } from './kin'

/** 取某 class 的全部 token 文本，便于断言「某语义被识别」而不绑死 token 序列。 */
const pick = (line: string, cls: string) =>
  tokenizeLine(line).filter((t) => t.cls === cls).map((t) => t.text)
const text = (line: string) => tokenizeLine(line).map((t) => t.text).join('')

describe('tokenizeLine —— 语义着色', () => {
  it('整行还原：token 拼回原文一字不差', () => {
    const samples = [
      '// 注释',
      '=== 码头开场 ===',
      '~ let imposter = random(0, 1)   // 开局随机',
      '* {!know_geo} [摊开地图] -> 出发前',
      '> > 「走水路。」',
      '雾里传来一声汽笛，{ shuffle("闷在水汽里", "辨不出") }。',
    ]
    for (const s of samples) expect(text(s)).toBe(s)
  })

  it('整行注释 → t-comment', () => {
    expect(pick('// 雾港之夜', 't-comment')).toContain('// 雾港之夜')
  })

  it('行尾注释与代码分离', () => {
    expect(pick('~ let x = 0   // 计数', 't-comment')).toEqual(['// 计数'])
    expect(pick('~ let x = 0   // 计数', 't-keyword')).toContain('let')
  })

  it('节点头 === name === → 名字是 t-node、分隔符 t-node-d', () => {
    expect(pick('=== 酒馆闲谈 ===', 't-node')).toEqual(['酒馆闲谈'])
    expect(pick('=== 酒馆闲谈 ===', 't-node-d')).toEqual(['===', '==='])
  })

  it('选项标记 * / + → t-marker，且选项内 [] 为 t-bracket', () => {
    expect(pick('* [收好东西] -> 入座', 't-marker')[0]).toMatch(/^\*/)
    expect(pick('* [收好东西] -> 入座', 't-bracket')).toEqual(['[收好东西]'])
    expect(pick('+ 粘性选项', 't-marker')[0]).toMatch(/^\+/)
  })

  it('逻辑行 ~ → t-logic 标记 + 关键字/数字着色', () => {
    expect(pick('~ let asked = 0', 't-logic')[0]).toMatch(/^~/)
    expect(pick('~ let asked = 0', 't-keyword')).toContain('let')
    expect(pick('~ let asked = 0', 't-num')).toContain('0')
  })

  it('命令行 @ → t-command；@bg_show 的字符串实参 t-string', () => {
    expect(pick('@bg_show("harbor_fog.jpg")', 't-command')).toContain('@bg_show')
    expect(pick('@bg_show("harbor_fog.jpg")', 't-string')).toEqual(['"harbor_fog.jpg"'])
  })

  it('跳转 -> 目标 → t-divert', () => {
    expect(pick('-> 出发前', 't-divert')[0]).toMatch(/->\s*出发前/)
    expect(pick('我看准了。\n'.trim() + ' -> 交付', 't-divert')[0]).toMatch(/->\s*交付/)
  })

  it('插值 { } → t-interp 包裹，内部函数名也着色', () => {
    const toks = tokenizeLine('{ once("看一眼。") }')
    expect(toks.some((t) => t.cls === 't-interp' && t.text === '{')).toBe(true)
    expect(toks.some((t) => t.cls === 't-interp' && t.text === '}')).toBe(true)
    expect(toks.some((t) => t.cls === 't-string' && t.text === '"看一眼。"')).toBe(true)
  })

  it('前导分支符 > → depth-guide', () => {
    expect(pick('> > 你借灯影摊开地图。', 'depth-guide')[0]).toMatch(/^>/)
  })

  it('空行 → 空 token 列表', () => {
    expect(tokenizeLine('')).toEqual([])
  })

  it('内联富文本标签 <b>…</b> → t-tag，包裹的文字仍是正文', () => {
    expect(pick('她说：<b>别回头</b>。', 't-tag')).toEqual(['<b>', '</b>'])
    expect(pick('她说：<b>别回头</b>。', 't-text')).toContain('别回头')
  })

  it('取值标签 <color=…> / <size=…> 连取值一起 t-tag', () => {
    expect(pick('<color=#c00>红</color>', 't-tag')).toEqual(['<color=#c00>', '</color>'])
    expect(pick('这个词<size=1.5>很大</size>。', 't-tag')).toEqual(['<size=1.5>', '</size>'])
  })

  it('自闭合 <br> → t-tag', () => {
    expect(pick('第一行<br>第二行', 't-tag')).toEqual(['<br>'])
  })

  it('其余标签可着色：斜体/下划线/删除线', () => {
    expect(pick('<i>斜</i><u>下</u><s>删</s>', 't-tag')).toEqual([
      '<i>', '</i>', '<u>', '</u>', '<s>', '</s>',
    ])
  })

  it('非标签的字面 < 不误判为 t-tag', () => {
    expect(pick('若 1 < 2 则成立', 't-tag')).toEqual([])
    expect(text('若 1 < 2 则成立')).toBe('若 1 < 2 则成立')
  })

  it('含标签行整行还原一字不差', () => {
    const s = '她说：<b>别回头</b>，<color=#c00>消失在<i>雾</i>里</color>。'
    expect(text(s)).toBe(s)
  })
})

describe('parseNodes —— 节点导航', () => {
  const SRC = [
    '~ let x = 0',
    '-> 开场',
    '',
    '=== 开场 ===',
    '正文。',
    '-> 出发前',
    '=== 出发前 ===',
    '* [走] -> 开场',
    '=== 末 ===',
    '-> END',
  ].join('\n')

  it('抽出全部节点名与 1-based 行号', () => {
    const ns = parseNodes(SRC)
    expect(ns.map((n) => n.name)).toEqual(['开场', '出发前', '末'])
    expect(ns.find((n) => n.name === '开场')!.line).toBe(4)
    expect(ns.find((n) => n.name === '出发前')!.line).toBe(7)
  })

  it('统计每个节点体内的出向跳转数（含 -> END）', () => {
    const ns = parseNodes(SRC)
    expect(ns.find((n) => n.name === '开场')!.diverts).toBe(1)
    expect(ns.find((n) => n.name === '出发前')!.diverts).toBe(1)
    expect(ns.find((n) => n.name === '末')!.diverts).toBe(1)
  })

  it('无节点 → 空数组', () => {
    expect(parseNodes('只有正文，没有节点。')).toEqual([])
  })
})
