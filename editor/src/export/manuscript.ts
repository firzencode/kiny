import { parse, sortByPath, type ContentBlock, type InlineSegment, type ProjectFile } from '@kiny/engine'
import { isKinFile } from '../files/gateway'

/**
 * 线性文稿导出：把 .kin 项目按**声明顺序**摊平成可读文稿（Markdown / 纯文本）。
 * 节点为章、段落为正文、选项为列表（标注跳转目标）、条件分支 / 命令 / 跳转以注释行标注。
 * 插值 `{表达式}` 原样保留（运行期才有值）；逻辑行（代码）不落入文稿。
 * 任一文件解析失败抛 Error（提示先修错误；与导出 .kip / 网页同门槛）。
 */

export type ManuscriptFormat = 'md' | 'txt'

export interface ManuscriptOptions {
  format: ManuscriptFormat
  /** 文稿标题（缺省「线性文稿」）。 */
  title?: string
}

interface Ctx {
  format: ManuscriptFormat
  out: string[]
  indent: number
}

const IND = '  '

function push(ctx: Ctx, line: string) {
  ctx.out.push(IND.repeat(ctx.indent) + line)
}

function blank(ctx: Ctx) {
  ctx.out.push('')
}

/** 段数组 → 纯文本：literal 计值，interp 原样 `{expr}`，`<br>` 转空格。 */
function segmentsText(segments: InlineSegment[]): string {
  let s = ''
  for (const seg of segments) {
    if (seg.kind === 'literal') s += seg.value
    else if (seg.kind === 'interp') s += `{${seg.code}}`
    else s += ' '
  }
  return s
}

/** 选项文案：before + inner + after 拼接（空段跳过，用空格分隔）。 */
function choiceText(choice: { before: InlineSegment[]; inner: InlineSegment[] | null; after: InlineSegment[]; label: string | null }): string {
  const parts: string[] = []
  const before = segmentsText(choice.before).trim()
  if (before !== '') parts.push(before)
  if (choice.inner) {
    const inner = segmentsText(choice.inner).trim()
    if (inner !== '') parts.push(inner)
  }
  const after = segmentsText(choice.after).trim()
  if (after !== '') parts.push(after)
  return parts.join(' ')
}

function divertText(d: { target: string; args: string[] }): string {
  if (d.args.length > 0) return `${d.target}(${d.args.join(', ')})`
  return d.target
}

function renderBlock(block: ContentBlock, ctx: Ctx) {
  for (const el of block) {
    switch (el.kind) {
      case 'text': {
        const t = segmentsText(el.segments).trim()
        if (t !== '') push(ctx, el.glue ? t : `${t}${ctx.format === 'md' ? '  ' : ''}`)
        break
      }
      case 'divert':
        push(ctx, ctx.format === 'md' ? `→ ${divertText(el)}` : `(跳转 → ${divertText(el)})`)
        break
      case 'choiceGroup':
        for (const c of el.choices) {
          const text = choiceText(c)
          const target = c.resultDivert !== null ? ` → ${divertText(c.resultDivert)}` : ''
          push(ctx, ctx.format === 'md' ? `- ${text}${target}` : `选项：${text}${target}`)
          renderBlock(c.body, { ...ctx, indent: ctx.indent + 1 })
        }
        break
      case 'conditional':
        for (const b of el.branches) {
          const head = b.condition === null ? '@else' : `@if {${b.condition}}`
          push(ctx, ctx.format === 'md' ? `> ${head}` : head)
          renderBlock(b.body, { ...ctx, indent: ctx.indent + 1 })
        }
        break
      case 'command':
        push(ctx, ctx.format === 'md' ? `（命令 @${el.name}(${el.args.join(', ')})）` : `（@${el.name}(${el.args.join(', ')})）`)
        break
      case 'logicLine':
      case 'logicBlock':
        // 代码不是文稿
        break
    }
  }
}

function knotHeading(name: string, params: string[], ctx: Ctx): string {
  const sig = params.length > 0 ? `（参数：${params.join(', ')}）` : ''
  if (ctx.format === 'md') return `### ${name}${sig}`
  return `【${name}】${sig}`
}

/** 生成线性文稿；sources 传全部 .kin 缓冲（含未保存改动）。 */
export function buildManuscript(
  sources: { path: string; source: string }[],
  opts: ManuscriptOptions,
): string {
  const ctx: Ctx = { format: opts.format, out: [], indent: 0 }
  const title = opts.title ?? '线性文稿'

  if (ctx.format === 'md') {
    ctx.out.push(`# ${title}`, '')
    ctx.out.push('> 由 Kiny Editor 导出 · 按声明顺序排列 · 选项标注跳转目标 · 插值 `{…}` 保留原文', '')
  } else {
    ctx.out.push(title, '（Kiny Editor 导出 · 按声明顺序排列）', '')
  }

  const sorted = sortByPath(sources.filter((s) => isKinFile(s.path)).map((s) => ({ path: s.path, source: s.source })))
  for (const src of sorted) {
    let file: ProjectFile
    try {
      file = parse(src.source, src.path)
    } catch (e) {
      throw new Error(`无法解析 ${src.path}：${e instanceof Error ? e.message : String(e)}`)
    }
    ctx.out.push(ctx.format === 'md' ? `## 文件：${src.path}` : `文件：${src.path}`, '')
    if (file.preamble.length > 0) {
      push(ctx, ctx.format === 'md' ? `#### 开场` : `【开场】`)
      renderBlock(file.preamble, { ...ctx, indent: 1 })
      blank(ctx)
    }
    for (const knot of file.knots) {
      push(ctx, knotHeading(knot.name, knot.params, ctx))
      renderBlock(knot.body, { ...ctx, indent: 1 })
      for (const st of knot.stitches) {
        push(ctx, ctx.format === 'md' ? `#### 子节点：${st.name}` : `【子节点：${st.name}】`)
        renderBlock(st.body, { ...ctx, indent: 1 })
      }
      blank(ctx)
    }
  }
  return ctx.out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
