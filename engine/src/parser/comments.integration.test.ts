import { describe, it, expect } from 'vitest'
import { stripComments } from './comments'
import { parseStructure } from './structure'

describe('stripComments ∘ parseStructure', () => {
  it('注释在结构解析前被剥离，正文不含注释文本、行号不变', () => {
    const src = ['=== A ===', '你好 // 注释', '/* 块 */', '再见'].join('\n')
    const file = parseStructure(stripComments(src, 'f.kin'), 'f.kin')
    expect(file.knots).toHaveLength(1)
    const body = file.knots[0]!.body
    expect(body.map((l) => l.text.trimEnd())).toEqual(['你好', '', '再见'])
    expect(body.map((l) => l.line)).toEqual([2, 3, 4])
  })

  it('块注释吃掉一个节点声明后，该节点不再被解析出来', () => {
    const src = ['=== A ===', '/* ', '=== B ===', ' */', '尾'].join('\n')
    const file = parseStructure(stripComments(src, 'f.kin'), 'f.kin')
    expect(file.knots.map((k) => k.name)).toEqual(['A'])
  })

  it('豁免区域（命令行 / 行末内联 ->）经 pass 0 后原样落入 body', () => {
    const src = ['=== A ===', '@bg_show("http://x.jpg")', '走吧。-> 商店("http://y")'].join('\n')
    const file = parseStructure(stripComments(src, 'f.kin'), 'f.kin')
    expect(file.knots[0]!.body.map((l) => l.text)).toEqual([
      '@bg_show("http://x.jpg")',
      '走吧。-> 商店("http://y")',
    ])
  })
})
