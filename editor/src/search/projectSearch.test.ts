import { describe, expect, it } from 'vitest'
import { buildSearchRe, groupByFile, replaceInText, searchBuffers, searchText } from './projectSearch'

const BUFFERS = [
  { path: 'main.kin', source: '=== 开场 ===\n雾港的夜晚。\n-> 码头\n' },
  { path: 'theme.css', source: '.text { color: #333; }\n' },
  { path: 'cover.png', source: 'binary' }, // 非文本：不参与搜索
]

describe('searchText', () => {
  it('基本命中带行号与列号', () => {
    const m = searchText(BUFFERS[0]!.source, 'main.kin', '雾港', {})
    expect(m).toHaveLength(1)
    expect(m[0]!.line).toBe(2)
    expect(m[0]!.text).toContain('雾港')
    expect(m[0]!.matched).toBe('雾港')
  })

  it('大小写敏感开关', () => {
    const src = 'Hello hello HELLO'
    expect(searchText(src, 'a.kin', 'hello', { caseSensitive: true })).toHaveLength(1)
    expect(searchText(src, 'a.kin', 'hello', {})).toHaveLength(3)
  })

  it('全词匹配', () => {
    const src = 'node nodes 节点'
    expect(searchText(src, 'a.kin', 'node', { wholeWord: true })).toHaveLength(1)
    expect(searchText(src, 'a.kin', '节点', { wholeWord: true })).toHaveLength(1)
  })

  it('正则搜索与非法正则报错', () => {
    expect(searchText('a1 a2 b3', 'a.kin', 'a\\d', { regex: true })).toHaveLength(2)
    expect(() => searchText('x', 'a.kin', '(', { regex: true })).toThrow(/无效/)
    expect(() => searchText('x', 'a.kin', '', {})).toThrow(/为空/)
  })

  it('同一行多次命中全部返回', () => {
    expect(searchText('哈 哈 哈', 'a.kin', '哈', {})).toHaveLength(3)
  })
})

describe('searchBuffers', () => {
  it('只搜文本文件，忽略图片', () => {
    const m = searchBuffers(BUFFERS, '#333', {})
    expect(m).toHaveLength(1)
    expect(m[0]!.path).toBe('theme.css')
  })

  it('groupByFile 按文件归组', () => {
    const m = searchBuffers(BUFFERS, '雾|color', { regex: true })
    const g = groupByFile(m)
    expect(g.map((x) => x.path)).toEqual(['main.kin', 'theme.css'])
  })

  it('buildSearchRe 支持全词与转义', () => {
    expect(buildSearchRe('a.b', {}).source).toContain('a\\.b')
    expect(buildSearchRe('x', { wholeWord: true }).source).toContain('(?<!')
  })
})

describe('replaceInText', () => {
  it('字面替换（不展开 $ 占位符）并返回命中数', () => {
    const r = replaceInText('甲 甲 乙', '甲', '丙$1', {})
    expect(r.count).toBe(2)
    expect(r.source).toBe('丙$1 丙$1 乙')
  })

  it('regex 搜索下替换仍按字面插入', () => {
    const r = replaceInText('a1 a2', 'a\\d', 'X', { regex: true })
    expect(r.source).toBe('X X')
  })

  it('替换后重新搜索不再命中', () => {
    const r = replaceInText('雾港 雾港', '雾港', '空港', {})
    expect(searchText(r.source, 'a.kin', '雾港', {})).toHaveLength(0)
  })
})
