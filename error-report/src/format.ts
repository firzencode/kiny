import { getErrorEntries, type ErrorEntry } from './errorLog'
import { getReportMeta, osLabel } from './meta'

/** GitHub 新建 issue 端点（开源镜像仓）。 */
export const GITHUB_NEW_ISSUE_URL = 'https://github.com/firzencode/kiny/issues/new'
/** 腾讯文档错误反馈问卷（大陆友好、无需账号；附录 A）。 */
export const FEEDBACK_FORM_URL = 'https://docs.qq.com/form/page/DR2htdnJOamNETFpK'

function entryBlock(e: ErrorEntry): string {
  let out = `- ${e.ts} [${e.source}] ${e.message}`
  if (e.stack) out += `\n${e.stack}`
  if (e.context) out += `\ncontext: ${e.context}`
  return out
}

/**
 * 自带结构的详情文本：应用名 + 版本 + OS + 时间 + 各错误条目（来源 / message / stack）。
 * 复制 / GitHub 预填 / 问卷粘贴共用。entries 默认取当前内存 buffer。
 * 传入 `recentLog`（磁盘日志近期尾部）时附在末尾——便于「非崩溃问题」也带上下文。
 */
export function buildCopyText(
  entries: ErrorEntry[] = getErrorEntries(),
  recentLog?: string | null,
): string {
  const meta = getReportMeta()
  const header = [
    `应用：${meta.appName} v${meta.appVersion}`,
    `系统：${osLabel()}`,
    `时间：${new Date().toISOString()}`,
    `错误条数：${entries.length}`,
  ].join('\n')
  const body = entries.length === 0 ? '（无错误记录）' : entries.map(entryBlock).join('\n\n')
  const logSection = recentLog ? `\n\n## 近期日志（末尾节选）\n${recentLog}` : ''
  return `${header}\n\n${body}${logSection}`
}

/** 拼出 GitHub 预填 issue 链接：标题 + body（详情 + 复现占位）+ labels=bug。 */
export function githubIssueUrl(entries: ErrorEntry[] = getErrorEntries()): string {
  const meta = getReportMeta()
  const latest = entries[entries.length - 1]
  const title = `[bug] ${latest ? latest.message : '运行时错误'} · ${meta.appName} v${meta.appVersion}`
  // 不嵌详情（避免与「复制详情」重复/冲突）：只留粘贴占位 + 让用户手填的复现步骤。
  const body = [
    '## 错误详情',
    '',
    '<!-- 在 Kiny 错误面板点「复制详情」，把内容粘贴到这里，替换本行 -->',
    '',
    '## 复现步骤',
    '',
    '<!-- 出错前你在做什么？ -->',
    '',
  ].join('\n')
  const params = new URLSearchParams({ title, body, labels: 'bug' })
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`
}
