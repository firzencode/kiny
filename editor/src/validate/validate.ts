import { parse as defaultParse, ParseError, analyze as defaultAnalyze } from '@kiny/engine'
import type { ProjectFile, Diagnostic, ValidatedProgram } from '@kiny/engine'
import { isKinFile } from '../files/gateway'

export interface ValidateResult {
  diagnostics: Diagnostic[]
  /** 无 error 时的 ValidatedProgram，否则 null。 */
  program: ValidatedProgram | null
}

/** 单文件 parse 的缓存产物：成功的 AST，或捕获到的 ParseError 诊断。 */
type ParseOutcome =
  | { ok: true; file: ProjectFile }
  | { ok: false; diagnostic: Diagnostic }

interface ValidatorDeps {
  /** 默认 engine 的 parse，可注入以在测试中观测调用次数。 */
  parse?: typeof defaultParse
  /** 默认 engine 的 analyze。 */
  analyze?: typeof defaultAnalyze
}

/** 解析单文件，把 ParseError 转成诊断；非 ParseError 异常照旧抛出。 */
function parseOne(parse: typeof defaultParse, source: string, path: string): ParseOutcome {
  try {
    return { ok: true, file: parse(source, path) }
  } catch (err) {
    if (err instanceof ParseError) {
      return { ok: false, diagnostic: { severity: 'error', code: 'parse', message: err.message, file: path, line: err.line } }
    }
    throw err
  }
}

/**
 * 带 per-file parse 缓存的增量校验器（spec：2026-06-20-editor-incremental-validate-design）。
 * 缓存按 path → { source, outcome }：source 未变则复用 AST、不重 parse；
 * 改动 / 新增的文件才重 parse；本次缺席的 path 逐出（删除 / 改名）。
 * analyze 始终对全部文件全量执行。输出与全量校验逐字段等价，缓存只影响 parse 是否重复调用。
 */
export function createIncrementalValidator(deps: ValidatorDeps = {}) {
  const parse = deps.parse ?? defaultParse
  const analyze = deps.analyze ?? defaultAnalyze
  const cache = new Map<string, { source: string; outcome: ParseOutcome }>()

  function validate(files: { path: string; source: string }[]): ValidateResult {
    const seen = new Set<string>()
    const outcomes: ParseOutcome[] = []
    for (const f of files) {
      seen.add(f.path)
      const hit = cache.get(f.path)
      let outcome: ParseOutcome
      if (hit && hit.source === f.source) {
        outcome = hit.outcome
      } else {
        outcome = parseOne(parse, f.source, f.path)
        cache.set(f.path, { source: f.source, outcome })
      }
      outcomes.push(outcome)
    }
    // 逐出本次缺席的 path（删除 / 改名）
    for (const path of [...cache.keys()]) {
      if (!seen.has(path)) cache.delete(path)
    }
    // 任一 parse 失败 → 连同全部 parse 错一起报、program=null（与全量校验短路一致）
    const parseErrors: Diagnostic[] = []
    const parsed: ProjectFile[] = []
    for (const o of outcomes) {
      if (o.ok) parsed.push(o.file)
      else parseErrors.push(o.diagnostic)
    }
    if (parseErrors.length > 0) return { diagnostics: parseErrors, program: null }
    return analyze(parsed)
  }

  return { validate }
}

/**
 * 跨文件全量校验（无缓存）：每次都重 parse 全部文件再 analyze。
 * 等价于 `createIncrementalValidator().validate(files)`，保留为无状态入口。
 */
export function validateProject(files: { path: string; source: string }[]): ValidateResult {
  return createIncrementalValidator().validate(files)
}

/**
 * 从编辑器缓冲里取出**送校验的 Kin 源码**。
 *
 * 缓冲装的是 gateway 载入的全部文本文件（`.kin` + 作品前端资源 css / js / json / txt / md / html），
 * 后者不是 Kin 源码——喂进 parse 只会得到假诊断：`theme.css` 脚手架里的 `{` 会被当成未闭合插值，
 * 而新建项目必带该文件，于是「必现一条不存在的错」。
 *
 * 这是「哪些缓冲算 Kin 源码」的**单点判定**，两处消费：App 的防抖校验与动作层 `validate`。
 * 二者曾各自复述过滤逻辑而分叉（动作层漏了过滤），故收敛于此，勿再就地展开。
 */
export function kinSourcesOf(
  buffers: readonly { path: string; source: string }[],
): { path: string; source: string }[] {
  return buffers.filter((f) => isKinFile(f.path)).map((f) => ({ path: f.path, source: f.source }))
}
