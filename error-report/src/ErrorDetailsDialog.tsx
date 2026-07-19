import { useEffect, useRef, useState } from 'react'
import { getErrorEntries } from './errorLog'
import { buildCopyText, githubIssueUrl, FEEDBACK_FORM_URL } from './format'
import { copyText, openExternalUrl, openLogDir, readRecentLog } from './platform'

/**
 * 错误 / 反馈面板：列最近错误（message + stack + 来源 + 时间）+ 取证 / 反馈按钮（§5）。
 * 既兜底崩溃后取证，也可从「帮助」菜单主动打开反馈问题（此时多无错误条目，靠近期日志带上下文）。
 * 所有动作均为用户主动触发的本地操作；面板明示提醒「日志可能含你的故事文本，提交前可自行删改」。
 */
export function ErrorDetailsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // 焦点管理（X3，崩溃取证面板须键盘可用）：打开时记住先前焦点并移焦到关闭按钮；关闭 / 卸载还焦。
  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    closeBtnRef.current?.focus()
    return () => prevFocusRef.current?.focus?.()
  }, [open])

  // 复制反馈的 setTimeout 清理（A6）：卸载时清，防 setState-on-unmounted / 定时器叠加。
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  if (!open) return null
  const entries = getErrorEntries()

  // 复制详情附磁盘日志近期尾部，便于非崩溃问题排查（GitHub 预填走 URL、不嵌日志，提示用复制详情粘贴）。
  const handleCopy = async () => {
    const log = await readRecentLog()
    await copyText(buildCopyText(entries, log))
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  // 键盘：Esc 关闭；Tab 在面板内可聚焦元素间循环（focus trap）。
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key !== 'Tab') return
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const list = nodes ? Array.from(nodes).filter((el) => !el.hasAttribute('disabled')) : []
    if (list.length === 0) return
    const first = list[0], last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div
      className="error-report-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="问题反馈"
      style={overlay}
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div ref={dialogRef} className="error-report-dialog" style={dialog} onClick={(e) => e.stopPropagation()}>
        <header style={head}>
          <h2 style={{ margin: 0, fontSize: 16 }}>问题反馈</h2>
          <button ref={closeBtnRef} className="error-report-close" onClick={onClose} aria-label="关闭" style={iconBtn}>
            ×
          </button>
        </header>

        <p style={hint}>
          「复制详情」会附上近期日志（含非崩溃记录）。提交前请留意：日志可能含你的故事文本，可自行删改敏感内容后再提交。
        </p>

        <div className="error-report-entries" style={entriesBox}>
          {entries.length === 0 ? (
            <p style={{ opacity: 0.7 }}>暂无崩溃 / 错误记录。若要反馈问题，直接点下方「复制详情」（会带上近期日志）或「填写反馈问卷」。</p>
          ) : (
            entries
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={i} style={entryItem}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {e.ts} · {e.source}
                  </div>
                  <div style={{ fontWeight: 600 }}>{e.message}</div>
                  {e.stack && <pre style={stackPre}>{e.stack}</pre>}
                </div>
              ))
          )}
        </div>

        <footer style={foot}>
          <div style={stepRow}>
            <span style={stepNum}>1</span>
            <button className="error-report-action" onClick={handleCopy} style={primaryBtn}>
              {copied ? '已复制 ✓' : '复制详情'}
            </button>
            <span style={stepHint}>先复制（含近期日志）</span>
          </div>
          <div style={stepRow}>
            <span style={stepNum}>2</span>
            <button
              className="error-report-action"
              onClick={() => openExternalUrl(githubIssueUrl(entries))}
              style={btn}
            >
              提交到 GitHub
            </button>
            <span style={orText}>或</span>
            <button
              className="error-report-action"
              onClick={() => openExternalUrl(FEEDBACK_FORM_URL)}
              style={btn}
            >
              填写反馈问卷
            </button>
            <span style={stepHint}>把复制的内容粘贴进去</span>
          </div>
          <div style={bottomRow}>
            <button className="error-report-action" onClick={() => openLogDir()} style={subtleBtn}>
              打开日志文件夹
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// 自包含内联样式：包不依赖宿主 CSS，editor / reader 双端开箱即用；类名保留供宿主覆盖。
const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
}
const dialog: React.CSSProperties = {
  background: '#1e1e1e',
  color: '#e6e6e6',
  width: 'min(720px, 92vw)',
  maxHeight: '82vh',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}
const head: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  fontSize: 22,
  cursor: 'pointer',
  lineHeight: 1,
}
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.75, margin: '8px 0' }
const entriesBox: React.CSSProperties = { overflow: 'auto', flex: 1, minHeight: 0, margin: '4px 0' }
const entryItem: React.CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,0.1)',
  padding: '8px 0',
}
const stackPre: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontSize: 12,
  opacity: 0.85,
  margin: '4px 0 0',
  maxHeight: 160,
  overflow: 'auto',
}
const foot: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }
const stepRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
const stepNum: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: '#3b82f6',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1,
  flex: 'none',
}
const orText: React.CSSProperties = { fontSize: 12, opacity: 0.6, margin: '0 2px' }
const stepHint: React.CSSProperties = { fontSize: 12, opacity: 0.6 }
const bottomRow: React.CSSProperties = {
  display: 'flex',
  marginTop: 2,
  paddingTop: 10,
  borderTop: '1px solid rgba(255,255,255,0.1)',
}
const btn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}
const primaryBtn: React.CSSProperties = { ...btn, background: '#3b82f6', borderColor: '#3b82f6', color: '#fff' }
const subtleBtn: React.CSSProperties = { ...btn, fontSize: 12, opacity: 0.8, padding: '4px 10px' }
