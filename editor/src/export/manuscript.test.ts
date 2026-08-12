import { describe, expect, it } from 'vitest'
import { buildManuscript } from './manuscript'

const SRC = [
  '=== 开场 ===',
  '雾港的夜晚，{主角}登上了码头。',
  '* [留下] 陪老人聊天',
  '> 老人笑了。',
  '-> 集市',
  '@bgm_play("雨声")',
  '=== 集市(p) ===',
  '热闹极了。',
  '@if {主角 === "侦探"}',
  ' > 有人认出了你。',
  '@else',
  ' > 无人注意。',
  '= 摊贩',
  '讨价还价。',
].join('\n')

describe('buildManuscript', () => {
  it('Markdown：章节 / 正文 / 选项标注 / 命令与条件分支', () => {
    const md = buildManuscript([{ path: 'main.kin', source: SRC }], { format: 'md', title: '雾港之夜' })
    expect(md).toContain('# 雾港之夜')
    expect(md).toContain('## 文件：main.kin')
    expect(md).toContain('### 开场')
    expect(md).toContain('雾港的夜晚，{主角}登上了码头。') // 插值原样保留
    expect(md).toContain('- 留下 陪老人聊天')
    expect(md).toContain('> @if {主角 === "侦探"}')
    expect(md).toContain('> @else')
    expect(md).toContain('（命令 @bgm_play("雨声")）')
    expect(md).toContain('### 集市（参数：p）')
    expect(md).toContain('#### 子节点：摊贩')
    expect(md).toContain('→ 集市')
  })

  it('纯文本：无 Markdown 标记，用缩进与注释形态', () => {
    const txt = buildManuscript([{ path: 'main.kin', source: SRC }], { format: 'txt' })
    expect(txt).not.toContain('# 雾港之夜')
    expect(txt).toContain('【开场】')
    expect(txt).toContain('选项：留下 陪老人聊天')
    expect(txt).toContain('（@bgm_play("雨声")）')
    expect(txt).toContain('【集市】（参数：p）')
  })

  it('多文件按路径字典序输出；非 .kin 文件忽略', () => {
    const md = buildManuscript(
      [
        { path: 'b.kin', source: '=== 二 ===\n乙。' },
        { path: 'theme.css', source: 'body{}' },
        { path: 'a.kin', source: '=== 一 ===\n甲。' },
      ],
      { format: 'md' },
    )
    expect(md.indexOf('## 文件：a.kin')).toBeLessThan(md.indexOf('## 文件：b.kin'))
    expect(md).not.toContain('theme.css')
  })

  it('解析失败抛可读错误', () => {
    expect(() =>
      buildManuscript([{ path: 'broken.kin', source: '=== 未闭合' }], { format: 'md' }),
    ).toThrow(/无法解析/)
  })

  it('结尾无多余空行，连续空行收敛', () => {
    const md = buildManuscript([{ path: 'main.kin', source: SRC }], { format: 'md' })
    expect(md.endsWith('\n')).toBe(true)
    expect(md).not.toContain('\n\n\n')
  })
})
