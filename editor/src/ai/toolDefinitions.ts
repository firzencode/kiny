import type { ToolDefinition } from './provider'
import type { ActionName } from './actions'

/**
 * 动作层命令 → LLM tool-definition 映射（spec 2026-06-24-editor-ai-integration §3.3）。
 *
 * 每个动作层命令（{@link ActionName}）对应一条 tool-definition，喂给 provider 作 OpenAI tool。
 * `parameters` 是描述该命令参数的 JSON Schema，与 actions.ts 的 `ActionCommand` 联合一一对齐。
 */

type Schema = {
  type: 'object'
  properties: Record<string, { type: string; description?: string }>
  required?: string[]
}

const str = (description: string) => ({ type: 'string', description })
const int = (description: string) => ({ type: 'integer', description })

function obj(properties: Schema['properties'], required: string[] = []): Schema {
  return required.length > 0 ? { type: 'object', properties, required } : { type: 'object', properties }
}

/** 命令名 → {描述, 参数 schema}。覆盖动作层全部 20 个命令。 */
const SPECS: Record<ActionName, { description: string; parameters: Schema }> = {
  // ---- 项目 / 文件 ----
  listProject: { description: '列出当前项目结构：项目根、manifest、文件清单、已打开的 tab 与活动文件。', parameters: obj({}) },
  readFile: { description: '读取一个 .kin 文件当前编辑缓冲的源码（含是否有未保存改动）。', parameters: obj({ path: str('项目根相对路径，如 chapters/a.kin') }, ['path']) },
  createFile: { description: '新建一个文件并打开为活动 tab。', parameters: obj({ path: str('新文件的项目根相对路径') }, ['path']) },
  writeFile: { description: '整体替换某文件缓冲的内容（落脏标记、可撤销，不直接写盘）。', parameters: obj({ path: str('目标文件路径'), source: str('新的完整源码') }, ['path', 'source']) },
  renamePath: { description: '重命名 / 移动一个文件或目录（入口文件会同步 kiny.json 的 entry）。', parameters: obj({ from: str('原路径'), to: str('新路径') }, ['from', 'to']) },
  deletePath: { description: '删除一个文件或目录（入口文件不可删）。', parameters: obj({ path: str('要删除的路径') }, ['path']) },
  createFolder: { description: '新建一个空目录。', parameters: obj({ relDir: str('项目根相对目录路径') }, ['relDir']) },
  // ---- 节点 / 文本 ----
  listNodes: { description: '列出某文件内的全部节点（含子节点）及其行号。', parameters: obj({ path: str('目标文件路径') }, ['path']) },
  readNode: { description: '读取某文件内某个节点的源码片段（从 === 头到下一节点前）。', parameters: obj({ path: str('目标文件路径'), node: str('节点名') }, ['path', 'node']) },
  replaceRange: { description: '按字符偏移替换某文件缓冲的一段区间（落脏标记、可撤销）。', parameters: obj({ path: str('目标文件路径'), start: int('起始字符偏移（含）'), end: int('结束字符偏移（不含）'), text: str('替换文本') }, ['path', 'start', 'end', 'text']) },
  insertText: { description: '在某文件缓冲的指定字符偏移处插入文本（落脏标记、可撤销）。', parameters: obj({ path: str('目标文件路径'), offset: int('插入位置的字符偏移'), text: str('要插入的文本') }, ['path', 'offset', 'text']) },
  // ---- 校验 / 诊断 ----
  validate: { description: '对当前所有文件做一次跨文件校验，返回是否通过与诊断列表。', parameters: obj({}) },
  getDiagnostics: { description: '取当前缓存的诊断（可按文件过滤），不重新校验。', parameters: obj({ path: str('可选：只取此文件的诊断') }) },
  // ---- 预览 / 运行 ----
  preview: { description: '取当前预览/运行的故事状态快照（PlayState）。', parameters: obj({}) },
  choose: { description: '在预览中做一个选择（推进剧情）。', parameters: obj({ pos: int('选项序号') }, ['pos']) },
  restart: { description: '重启预览，从故事开头重新运行。', parameters: obj({}) },
  // ---- 保存 ----
  saveFile: { description: '把某文件缓冲写盘（清脏标记）。', parameters: obj({ path: str('目标文件路径') }, ['path']) },
  saveAll: { description: '把所有有未保存改动的文件写盘。', parameters: obj({}) },
  // ---- 语言规范查询 ----
  listKinSpec: { description: '列出 Kin 语言规范的章节目录（id + 标题 + 层级），用于发现可查的详细规则章节。', parameters: obj({}) },
  readKinSpec: { description: '按章节 id 读取 Kin 规范某章 / 节的完整原文（规则、示例、边界），并返回其直接子节清单；取章只回章引言，子节经各自 id 再取。先用 listKinSpec 查 id。', parameters: obj({ id: str('章节 id，如 5 或 5.3') }, ['id']) },
}

/** 全部动作层命令的 tool-definitions。 */
export const TOOL_DEFINITIONS: ToolDefinition[] = (Object.keys(SPECS) as ActionName[]).map((name) => ({
  name,
  description: SPECS[name].description,
  parameters: SPECS[name].parameters as unknown as Record<string, unknown>,
}))
