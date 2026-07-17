import type { ActionName } from './actions'

/**
 * 动作层命令的运行时元数据单一真相源（T040a）。
 *
 * `ACTION_MANIFEST` 是本仓库描述「有哪些命令、各自参数是什么」的**唯一**真相源：
 * LLM tool-definitions（{@link ../ai/toolDefinitions.ts}）与后续对外 REST/CLI 均从此派生，
 * 禁止在别处再手写命令表。
 */

/** 单个参数的规格。type 用 'integer' 与 JSON Schema 对齐（对应 TS number）。 */
export interface ParamSpec {
  type: 'string' | 'integer'
  required: boolean
  desc: string
  /** true = 内容型参数：CLI 只接 --<p>-file/--<p>-stdin，禁内联（防 shell 换行截断/长度上限静默丢内容）。仅 CLI 输入通道语义，不影响 JSON Schema。 */
  content?: true
}

/** 单条命令的运行时元数据。命令名/描述/参数的唯一真相源。 */
export interface CommandSpec {
  name: ActionName
  desc: string
  params: Record<string, ParamSpec>
}

const s = (desc: string, required = true): ParamSpec => ({ type: 'string', required, desc })
const i = (desc: string, required = true): ParamSpec => ({ type: 'integer', required, desc })
/** 内容型 string 参数（必填）：CLI 经 file/stdin 输入，禁内联。 */
const c = (desc: string): ParamSpec => ({ type: 'string', required: true, desc, content: true })

/**
 * 动作层全部 21 命令的运行时清单——单一真相源。
 * LLM tool-definitions（toolDefinitions.ts）与对外 REST/CLI 均从此派生，禁止别处再手写命令表。
 */
export const ACTION_MANIFEST: readonly CommandSpec[] = [
  { name: 'listProject', desc: '列出当前项目结构：项目根、manifest、文件清单、已打开的 tab 与活动文件。', params: {} },
  { name: 'readFile', desc: '读取一个 .kin 文件当前编辑缓冲的源码（含是否有未保存改动）。', params: { path: s('项目根相对路径，如 chapters/a.kin') } },
  { name: 'createFile', desc: '新建一个文件并打开为活动 tab。', params: { path: s('新文件的项目根相对路径') } },
  { name: 'writeFile', desc: '整体替换某文件缓冲的内容（落脏标记、可撤销，不直接写盘）。', params: { path: s('目标文件路径'), source: c('新的完整源码') } },
  { name: 'renamePath', desc: '重命名 / 移动一个文件或目录（入口文件会同步 kiny.json 的 entry）。', params: { from: s('原路径'), to: s('新路径') } },
  { name: 'deletePath', desc: '删除一个文件或目录（入口文件不可删）。', params: { path: s('要删除的路径') } },
  { name: 'createFolder', desc: '新建一个空目录。', params: { relDir: s('项目根相对目录路径') } },
  { name: 'listNodes', desc: '列出某文件内的全部节点（含子节点）及其行号。', params: { path: s('目标文件路径') } },
  { name: 'readNode', desc: '读取某文件内某个节点的源码片段（从 === 头到下一节点前）。', params: { path: s('目标文件路径'), node: s('节点名') } },
  { name: 'replaceRange', desc: '按字符偏移替换某文件缓冲的一段区间（落脏标记、可撤销）。', params: { path: s('目标文件路径'), start: i('起始字符偏移（含）'), end: i('结束字符偏移（不含）'), text: c('替换文本') } },
  { name: 'insertText', desc: '在某文件缓冲的指定字符偏移处插入文本（落脏标记、可撤销）。', params: { path: s('目标文件路径'), offset: i('插入位置的字符偏移'), text: c('要插入的文本') } },
  { name: 'validate', desc: '对当前所有文件做一次跨文件校验，返回是否通过与诊断列表。', params: {} },
  { name: 'getDiagnostics', desc: '取当前缓存的诊断（可按文件过滤），不重新校验。', params: { path: s('可选：只取此文件的诊断', false) } },
  { name: 'preview', desc: '取当前预览/运行的故事状态快照（PlayState）。', params: {} },
  { name: 'choose', desc: '在预览中做一个选择（推进剧情）。', params: { pos: i('选项序号') } },
  { name: 'submitInput', desc: '在预览的输入框中提交一段文本（推进剧情）。', params: { text: s('输入文本') } },
  { name: 'restart', desc: '重启预览，从故事开头重新运行。', params: {} },
  { name: 'saveFile', desc: '把某文件缓冲写盘（清脏标记）。', params: { path: s('目标文件路径') } },
  { name: 'saveAll', desc: '把所有有未保存改动的文件写盘。', params: {} },
  { name: 'listKinSpec', desc: '列出 Kin 语言规范的章节目录（id + 标题 + 层级），用于发现可查的详细规则章节。', params: {} },
  { name: 'readKinSpec', desc: '按章节 id 读取 Kin 规范某章 / 节的完整原文（规则、示例、边界），并返回其直接子节清单；取章只回章引言，子节经各自 id 再取。先用 listKinSpec 查 id。', params: { id: s('章节 id，如 5 或 5.3') } },
]

/**
 * 用 ACTION_MANIFEST 对一条命令做运行时参数校验。LLM tool call 与外部控制 HTTP 都是
 * **不可信输入**——缺参时 `undefined < 0` 这类边界检查会静默通过（曾致 insertText 缺
 * offset 把整份文档翻倍拼接），故必须在执行前按真相源校验。
 * 通过返回 null；否则返回聚合的人类可读错误（点名每个问题参数）。多余的未知参数不拒绝。
 */
export function validateCommandArgs(cmd: { name: string } & Record<string, unknown>): string | null {
  const spec = ACTION_MANIFEST.find((c) => c.name === cmd.name)
  if (!spec) return `未知命令: ${cmd.name}`
  const errors: string[] = []
  for (const [key, p] of Object.entries(spec.params)) {
    const v = cmd[key]
    if (v === undefined || v === null) {
      if (p.required) errors.push(`缺少必填参数 ${key}（${p.desc}）`)
      continue
    }
    if (p.type === 'string' && typeof v !== 'string') {
      errors.push(`参数 ${key} 应为 string，收到 ${typeof v}`)
    } else if (p.type === 'integer' && (typeof v !== 'number' || !Number.isInteger(v))) {
      errors.push(`参数 ${key} 应为整数，收到 ${JSON.stringify(v)}`)
    }
  }
  return errors.length > 0 ? errors.join('；') : null
}

/** 把一条命令的参数规格派生成 JSON Schema（供 LLM tool-definition 与 REST 文档用）。 */
export function manifestToJsonSchema(c: CommandSpec) {
  const properties: Record<string, { type: string; description?: string }> = {}
  const required: string[] = []
  for (const [name, p] of Object.entries(c.params)) {
    properties[name] = { type: p.type, description: p.desc }
    if (p.required) required.push(name)
  }
  return required.length > 0 ? { type: 'object' as const, properties, required } : { type: 'object' as const, properties }
}
