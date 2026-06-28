import { describe, it, expect } from 'vitest'
import { parseKinSpec, tableOfContents, getSection } from './kinSpec'

// fixture：一级标题无编号、章带引言+子节、叶子章无子节、围栏代码块内含 # 行。
const FIXTURE = [
  '# 顶级标题（无编号）',
  '',
  '> 引言',
  '',
  '## 1. 第一章',
  '',
  '第一章引言。',
  '',
  '### 1.1 子节甲',
  '',
  '子节甲正文。',
  '',
  '### 1.2 子节乙',
  '',
  '子节乙正文。',
  '',
  '```',
  '# 代码块里的井号，不是标题',
  '```',
  '',
  '## 2. 第二章',
  '',
  '第二章全文（无子节）。',
  '',
].join('\n')

describe('parseKinSpec', () => {
  it('只收带编号标题，跳过一级无编号标题与围栏内 # 行', () => {
    const ids = parseKinSpec(FIXTURE).map((s) => s.id)
    expect(ids).toEqual(['1', '1.1', '1.2', '2'])
  })

  it('取章正文只含章引言，不含子节正文', () => {
    const sec = parseKinSpec(FIXTURE).find((s) => s.id === '1')!
    expect(sec.title).toBe('第一章')
    expect(sec.level).toBe(2)
    expect(sec.content).toContain('第一章引言。')
    expect(sec.content).not.toContain('子节甲正文。')
  })

  it('叶子章正文含其全文', () => {
    const sec = parseKinSpec(FIXTURE).find((s) => s.id === '2')!
    expect(sec.content).toContain('第二章全文（无子节）。')
  })

  it('tableOfContents 剥掉正文', () => {
    const toc = tableOfContents(parseKinSpec(FIXTURE))
    expect(toc).toContainEqual({ id: '2', title: '第二章', level: 2 })
    expect(toc[0]).not.toHaveProperty('content')
  })

  it('getSection 取章带直接子节清单', () => {
    const d = getSection(parseKinSpec(FIXTURE), '1')!
    expect(d.children).toEqual([
      { id: '1.1', title: '子节甲' },
      { id: '1.2', title: '子节乙' },
    ])
    expect(d.content).toContain('第一章引言。')
  })

  it('getSection 取叶子节 children 为空', () => {
    expect(getSection(parseKinSpec(FIXTURE), '1.1')!.children).toEqual([])
  })

  it('getSection 未知 id 返回 undefined', () => {
    expect(getSection(parseKinSpec(FIXTURE), '99')).toBeUndefined()
  })
})
