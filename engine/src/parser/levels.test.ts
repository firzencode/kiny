import { describe, it, expect } from 'vitest'
import { splitLevel } from './levels'

describe('splitLevel', () => {
  it('无 > 的行是 level 0', () => {
    expect(splitLevel('你好')).toEqual({ level: 0, content: '你好' })
  })

  it('单个 > 是 level 1，剥掉标记与其后空白', () => {
    expect(splitLevel('> 体')).toEqual({ level: 1, content: '体' })
    expect(splitLevel('>体')).toEqual({ level: 1, content: '体' })
  })

  it('>>> 与 > > > 等价，都是 level 3', () => {
    expect(splitLevel('>>> x')).toEqual({ level: 3, content: 'x' })
    expect(splitLevel('> > > x')).toEqual({ level: 3, content: 'x' })
  })

  it('行首空白被忽略', () => {
    expect(splitLevel('   > 体')).toEqual({ level: 1, content: '体' })
  })

  it('行首 \\> 不算层级标记', () => {
    expect(splitLevel('\\> 字面')).toEqual({ level: 0, content: '\\> 字面' })
  })

  it('level 0 文本的行首缩进被剥掉（§3.2 缩进无语义）', () => {
    expect(splitLevel('    缩进文本')).toEqual({ level: 0, content: '缩进文本' })
  })
})
