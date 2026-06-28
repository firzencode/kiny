import { describe, it, expect, beforeEach } from 'vitest'
import { loadAiConfig, saveAiConfig, isConfigured, DEFAULT_AI_CONFIG } from './aiConfig'

describe('aiConfig', () => {
  beforeEach(() => localStorage.clear())

  it('无存储时返回默认（未配置）', () => {
    const c = loadAiConfig()
    expect(c).toEqual(DEFAULT_AI_CONFIG)
    expect(isConfigured(c)).toBe(false)
  })

  it('save 后 load 往返一致', () => {
    const c = { provider: 'openai-compatible' as const, endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', apiKey: 'sk-x' }
    saveAiConfig(c)
    expect(loadAiConfig()).toEqual(c)
    expect(isConfigured(loadAiConfig())).toBe(true)
  })

  it('endpoint/model/key 任一空白则未配置', () => {
    expect(isConfigured({ provider: 'openai-compatible', endpoint: ' ', model: 'm', apiKey: 'k' })).toBe(false)
    expect(isConfigured({ provider: 'openai-compatible', endpoint: 'https://x', model: '', apiKey: 'k' })).toBe(false)
    expect(isConfigured({ provider: 'openai-compatible', endpoint: 'https://x', model: 'm', apiKey: '' })).toBe(false)
  })

  it('坏 JSON 容错回默认', () => {
    localStorage.setItem('kiny-editor-ai', '{not json')
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG)
  })
})
