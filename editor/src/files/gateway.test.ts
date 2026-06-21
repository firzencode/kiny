import { describe, it, expect } from 'vitest'
import { defaultKipName } from './gateway'

describe('defaultKipName', () => {
  it('正常故事名加 .kip 后缀', () => {
    expect(defaultKipName('雾港之夜')).toBe('雾港之夜.kip')
  })
  it('过滤 Windows 文件名非法字符', () => {
    expect(defaultKipName('a/b:c*?"<>|\\d')).toBe('abcd.kip')
  })
  it('空名或全非法字符回退为 story', () => {
    expect(defaultKipName('   ')).toBe('story.kip')
    expect(defaultKipName('/\\:*?')).toBe('story.kip')
  })
})
