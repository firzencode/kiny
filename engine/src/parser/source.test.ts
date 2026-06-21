import { describe, it, expect } from 'vitest'
import { splitLines, normalizeNewlines } from './source'

describe('normalizeNewlines', () => {
  it('把 CRLF 与单独 CR 归一成 LF，不改变行数', () => {
    expect(normalizeNewlines('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })

  it('已是 LF 的文本原样返回', () => {
    expect(normalizeNewlines('a\nb')).toBe('a\nb')
  })
})

describe('splitLines', () => {
  it('编号从 1 开始', () => {
    expect(splitLines('a\nb\nc')).toEqual([
      { line: 1, text: 'a' },
      { line: 2, text: 'b' },
      { line: 3, text: 'c' },
    ])
  })

  it('把 CRLF 和单独的 CR 都归一成换行', () => {
    expect(splitLines('a\r\nb\rc')).toEqual([
      { line: 1, text: 'a' },
      { line: 2, text: 'b' },
      { line: 3, text: 'c' },
    ])
  })

  it('结尾的单个换行不产生多余空行', () => {
    expect(splitLines('a\nb\n')).toEqual([
      { line: 1, text: 'a' },
      { line: 2, text: 'b' },
    ])
  })

  it('保留中间空行', () => {
    expect(splitLines('a\n\nb')).toEqual([
      { line: 1, text: 'a' },
      { line: 2, text: '' },
      { line: 3, text: 'b' },
    ])
  })

  it('空字符串得到一行空文本', () => {
    expect(splitLines('')).toEqual([{ line: 1, text: '' }])
  })
})
