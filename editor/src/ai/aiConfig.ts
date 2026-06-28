/** AI 配置（spec 2026-06-24-editor-ai-integration §3.1）。本期 provider 固定 openai-compatible。 */
export interface AiConfig {
  provider: 'openai-compatible'
  endpoint: string
  model: string
  apiKey: string
}

export const AI_CONFIG_KEY = 'kiny-editor-ai'

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'openai-compatible',
  endpoint: '',
  model: '',
  apiKey: '',
}

/** endpoint / model / key 均非空白才算配好（可发请求）。 */
export function isConfigured(c: AiConfig): boolean {
  return c.endpoint.trim() !== '' && c.model.trim() !== '' && c.apiKey.trim() !== ''
}

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_AI_CONFIG }
    return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw), provider: 'openai-compatible' }
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

export function saveAiConfig(c: AiConfig): void {
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(c))
  } catch {
    /* 存储不可用时静默——与 settings/theme 持久化一致 */
  }
}
