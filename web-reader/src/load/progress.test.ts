import { describe, it, expect, beforeEach } from 'vitest'
import type { InteractionStep } from '@kiny/player'
import { progressKey, loadProgress, saveProgress, clearProgress } from './progress'

beforeEach(() => localStorage.clear())

describe('阅读进度持久化', () => {
  it('progressKey 按故事名 + 版本分桶（改版即不同键）', () => {
    expect(progressKey('雾港', '1.0.0')).toBe(progressKey('雾港', '1.0.0'))
    expect(progressKey('雾港', '1.0.0')).not.toBe(progressKey('雾港', '1.1.0'))
    expect(progressKey('雾港', '1.0.0')).not.toBe(progressKey('灯塔', '1.0.0'))
  })

  it('save → load 往返', () => {
    const key = progressKey('x', '1')
    const seq: InteractionStep[] = [{ kind: 'choice', pos: 0 }, { kind: 'input', text: '勇者' }]
    saveProgress(key, 42, seq)
    expect(loadProgress(key)).toEqual({ seed: 42, seq })
  })

  it('无进度 → null', () => {
    expect(loadProgress(progressKey('none', '1'))).toBeNull()
  })

  it('损坏数据 → null（不抛）：非法 JSON / seed 非数 / 非法 step', () => {
    const key = progressKey('bad', '1')
    localStorage.setItem(key, '{not json')
    expect(loadProgress(key)).toBeNull()
    localStorage.setItem(key, JSON.stringify({ seed: 'x', seq: [] }))
    expect(loadProgress(key)).toBeNull()
    localStorage.setItem(key, JSON.stringify({ seed: 1, seq: [{ kind: 'bogus' }] }))
    expect(loadProgress(key)).toBeNull()
    localStorage.setItem(key, JSON.stringify({ seed: 1, seq: [{ kind: 'choice', pos: 'x' }] }))
    expect(loadProgress(key)).toBeNull()
  })

  it('clear 删进度', () => {
    const key = progressKey('c', '1')
    saveProgress(key, 1, [])
    expect(loadProgress(key)).not.toBeNull()
    clearProgress(key)
    expect(loadProgress(key)).toBeNull()
  })
})
