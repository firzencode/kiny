import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, clampSettings, loadSettings, saveSettings,
  applySettingsVars, sanitizeFontName,
} from './settings'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('settings', () => {
  it('loadSettings 空存储回默认', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('loadSettings 合并部分字段到默认', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ codeSize: 16 }))
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, codeSize: 16 })
  })

  it('loadSettings 损坏 JSON 回默认', () => {
    localStorage.setItem(SETTINGS_KEY, '{ not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('loadSettings 对越界存储值夹紧', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ codeSize: 99, proseLh: 0 }))
    const s = loadSettings()
    expect(s.codeSize).toBe(20)
    expect(s.proseLh).toBe(1.5)
  })

  it('clampSettings 夹紧各数值到边界', () => {
    expect(clampSettings({ ...DEFAULT_SETTINGS, codeSize: 99 }).codeSize).toBe(20)
    expect(clampSettings({ ...DEFAULT_SETTINGS, codeSize: 1 }).codeSize).toBe(12)
    expect(clampSettings({ ...DEFAULT_SETTINGS, proseLh: 9 }).proseLh).toBe(2.4)
  })

  it('saveSettings 写入 localStorage', () => {
    saveSettings({ ...DEFAULT_SETTINGS, codeSize: 15 })
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).codeSize).toBe(15)
  })

  it('applySettingsVars 写 documentElement CSS 变量（含单位）', () => {
    const s = { ...DEFAULT_SETTINGS, codeSize: 15, codeLh: 1.5 }
    applySettingsVars(s)
    expect(document.documentElement.style.getPropertyValue('--code-size')).toBe('15px')
    expect(document.documentElement.style.getPropertyValue('--code-lh')).toBe('1.5')
    expect(document.documentElement.style.getPropertyValue('--code-font')).toBe(DEFAULT_SETTINGS.codeFont)
    expect(document.documentElement.style.getPropertyValue('--prose-font')).toBe(s.proseFont)
    expect(document.documentElement.style.getPropertyValue('--prose-size')).toBe(`${s.proseSize}px`)
    expect(document.documentElement.style.getPropertyValue('--prose-lh')).toBe(`${s.proseLh}`)
  })

  it('loadSettings 非数字存储值（NaN）回退到默认', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ codeSize: 'big' }))
    expect(loadSettings().codeSize).toBe(DEFAULT_SETTINGS.codeSize)
  })

  it('sanitizeFontName 剥离危险字符', () => {
    expect(sanitizeFontName('Fira; }<x>')).toBe('Fira x')
  })

  describe('aiChatRetentionDays', () => {
    it('默认 30 天', () => {
      expect(DEFAULT_SETTINGS.aiChatRetentionDays).toBe(30)
    })
    it('null（关闭清理）原样保留', () => {
      expect(clampSettings({ ...DEFAULT_SETTINGS, aiChatRetentionDays: null }).aiChatRetentionDays).toBeNull()
    })
    it('越界夹紧、非法回默认、小数取整', () => {
      expect(clampSettings({ ...DEFAULT_SETTINGS, aiChatRetentionDays: 0 }).aiChatRetentionDays).toBe(30)   // <1 非法回默认
      expect(clampSettings({ ...DEFAULT_SETTINGS, aiChatRetentionDays: 9999 }).aiChatRetentionDays).toBe(365)
      expect(clampSettings({ ...DEFAULT_SETTINGS, aiChatRetentionDays: 7.8 }).aiChatRetentionDays).toBe(7)
      expect(clampSettings({ ...DEFAULT_SETTINGS, aiChatRetentionDays: NaN as unknown as number }).aiChatRetentionDays).toBe(30)
    })
    it('loadSettings 合并存储的 null', () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ aiChatRetentionDays: null }))
      expect(loadSettings().aiChatRetentionDays).toBeNull()
    })
  })
})
