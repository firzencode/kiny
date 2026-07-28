import { describe, it, expect } from 'vitest'
import type { RichSpan } from '@kiny/engine'
import { spanClassName, liftLineClasses } from './spanClasses'

describe('spanClassName', () => {
  it('加 kin- 前缀，多类空格分隔', () => {
    expect(spanClassName(['whisper', 'letter'])).toBe('kin-whisper kin-letter')
  })

  it('无类名返回 undefined（不产出空 class 属性）', () => {
    expect(spanClassName(undefined)).toBeUndefined()
    expect(spanClassName([])).toBeUndefined()
  })
})

describe('liftLineClasses', () => {
  const t = (text: string, classes?: string[]): RichSpan => (classes ? { text, classes } : { text })

  it('全行同类 → 提到行级，span 上剥掉', () => {
    const r = liftLineClasses([t('见字', ['letter']), t('如晤', ['letter'])])
    expect(r.lineClasses).toEqual(['letter'])
    expect(r.spans).toEqual([{ text: '见字' }, { text: '如晤' }])
  })

  it('只覆盖部分内容 → 不提升，留在 span 上', () => {
    const spans = [t('他说'), t('三个字', ['whisper'])]
    const r = liftLineClasses(spans)
    expect(r.lineClasses).toEqual([])
    expect(r.spans).toBe(spans) // 无改动时原样返回，免无谓重建
  })

  it('多类只提共有的那部分', () => {
    const r = liftLineClasses([t('甲', ['letter', 'old']), t('乙', ['letter'])])
    expect(r.lineClasses).toEqual(['letter'])
    expect(r.spans).toEqual([{ text: '甲', classes: ['old'] }, { text: '乙' }])
  })

  it('break 段不算内容（不影响整行判定，原样保留）', () => {
    const r = liftLineClasses([t('上', ['letter']), { kind: 'break' }, t('下', ['letter'])])
    expect(r.lineClasses).toEqual(['letter'])
    expect(r.spans).toEqual([{ text: '上' }, { kind: 'break' }, { text: '下' }])
  })

  it('其它样式键原样保留', () => {
    const r = liftLineClasses([{ text: 'x', classes: ['a'], bold: true, font: '楷体' }])
    expect(r.lineClasses).toEqual(['a'])
    expect(r.spans).toEqual([{ text: 'x', bold: true, font: '楷体' }])
  })

  it('无类名 / 空行 → 空提升', () => {
    expect(liftLineClasses([t('纯文本')]).lineClasses).toEqual([])
    expect(liftLineClasses([]).lineClasses).toEqual([])
    expect(liftLineClasses([{ kind: 'break' }]).lineClasses).toEqual([])
  })
})
