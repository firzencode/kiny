import type { ToolDefinition } from './provider'
import { ACTION_MANIFEST, manifestToJsonSchema } from './actionManifest'

/**
 * 动作层命令 → LLM tool-definition 映射（spec 2026-06-24-editor-ai-integration §3.3）。
 *
 * 命令元数据的唯一真相源是 {@link ACTION_MANIFEST}；本文件只做「清单 → OpenAI tool」的派生。
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = ACTION_MANIFEST.map((c) => ({
  name: c.name,
  description: c.desc,
  parameters: manifestToJsonSchema(c) as unknown as Record<string, unknown>,
}))
