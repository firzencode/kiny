import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(() => Promise.resolve()) }))

import { buildCopyText, githubIssueUrl, GITHUB_NEW_ISSUE_URL } from './format'
import { logErrorEntry, clearErrorEntries } from './errorLog'
import { configureErrorReport } from './meta'

beforeEach(() => {
  clearErrorEntries()
  configureErrorReport({ appName: 'Kiny 阅读器', appVersion: '1.2.3' })
})

describe('buildCopyText', () => {
  it('自带结构：应用名 + 版本 + 系统 + 条目', () => {
    logErrorEntry({ source: 'operation:importKip', message: '导入失败', stack: 'at x' })
    const text = buildCopyText()
    expect(text).toContain('Kiny 阅读器 v1.2.3')
    expect(text).toContain('系统：')
    expect(text).toContain('[operation:importKip] 导入失败')
    expect(text).toContain('at x')
  })

  it('无错误时给占位文本', () => {
    expect(buildCopyText()).toContain('（无错误记录）')
  })

  it('传入近期日志时附在末尾（非崩溃反馈也有上下文）', () => {
    const text = buildCopyText([], '[info] app started · v1.2.3\n[error] boom')
    expect(text).toContain('（无错误记录）')
    expect(text).toContain('## 近期日志（末尾节选）')
    expect(text).toContain('app started')
  })
})

describe('githubIssueUrl', () => {
  it('预填 title + body + labels=bug', () => {
    logErrorEntry({ source: 'react-boundary', message: '渲染崩溃' })
    const url = githubIssueUrl()
    expect(url.startsWith(GITHUB_NEW_ISSUE_URL + '?')).toBe(true)
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('labels')).toBe('bug')
    expect(qs.get('title')).toContain('渲染崩溃')
    expect(qs.get('body')).toContain('复现步骤')
  })
})
