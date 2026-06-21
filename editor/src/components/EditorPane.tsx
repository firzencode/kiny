import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { tokenizeLine } from '../syntax/kin'
import { readClipboardText } from '../clipboard'

type EditCmd = 'cut' | 'copy' | 'paste' | 'selectAll'

const CTX_ITEMS: { cmd: EditCmd; label: string }[] = [
  { cmd: 'cut', label: '剪切' },
  { cmd: 'copy', label: '复制' },
  { cmd: 'paste', label: '粘贴' },
  { cmd: 'selectAll', label: '全选' },
]

export interface EditorHandle {
  exec(cmd: 'cut' | 'copy' | 'paste' | 'selectAll'): void
  focus(): void
}

interface EditorPaneProps {
  source: string
  onChange: (next: string) => void
  caretLine: number | null
  activeLine?: number
  onCaretMove?: (line: number) => void
  /** 关闭语义着色（视图菜单）。默认 true。 */
  highlight?: boolean
}

/**
 * 编辑区：行号栏 + 语义高亮层 + 受控 textarea（文字透明叠在高亮 pre 上）。
 * 外层 .editor-pane 统一滚动；textarea 高度撑满内容。
 * 暴露命令句柄（编辑菜单的剪切/复制/粘贴/全选作用于内部 textarea）。
 */
export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { source, onChange, caretLine, activeLine, onCaretMove, highlight = true },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const lines = source.split('\n')

  // 自定义右键菜单位置（屏蔽了 webview 原生菜单，编辑命令自己做）
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  // 粘贴/插入后待恢复的光标位置（受控 textarea 改值会令光标跳到末尾）
  const pendingCaret = useRef<number | null>(null)

  // webview 出于安全禁用 execCommand('paste')，改走 Tauri 剪贴板插件读取后手动插入。
  const pasteFromClipboard = async () => {
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    let text = ''
    try {
      text = await readClipboardText()
    } catch {
      return /* 剪贴板不可读（权限/环境）：忽略，键盘 Ctrl+V 仍可用 */
    }
    if (!text) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    pendingCaret.current = start + text.length
    onChange(source.slice(0, start) + text + source.slice(end))
  }

  const runCmd = (cmd: EditCmd) => {
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    if (cmd === 'selectAll') {
      ta.select()
      return
    }
    if (cmd === 'paste') {
      void pasteFromClipboard()
      return
    }
    try {
      document.execCommand(cmd)
    } catch {
      /* 部分环境不支持 execCommand：忽略（键盘快捷键仍可用） */
    }
  }

  useImperativeHandle(ref, () => ({
    focus() {
      taRef.current?.focus()
    },
    exec(cmd) {
      runCmd(cmd)
    },
  }))

  useLayoutEffect(() => {
    if (taRef.current && preRef.current) taRef.current.style.height = preRef.current.offsetHeight + 'px'
    // 粘贴/插入后把光标恢复到插入文本之后（而非受控改值默认跳到的末尾）
    if (pendingCaret.current !== null && taRef.current) {
      const pos = pendingCaret.current
      pendingCaret.current = null
      taRef.current.setSelectionRange(pos, pos)
    }
  }, [source])

  useEffect(() => {
    if (caretLine === null || !taRef.current) return
    const offset = lines.slice(0, caretLine - 1).reduce((n, l) => n + l.length + 1, 0)
    const ta = taRef.current
    ta.focus()
    ta.setSelectionRange(offset, offset)
    const pane = paneRef.current
    const pre = preRef.current
    if (pane && pre) {
      const lh = parseFloat(getComputedStyle(pre).lineHeight) || 22
      pane.scrollTop = Math.max(0, (caretLine - 3) * lh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretLine])

  const reportCaret = () => {
    const ta = taRef.current
    if (!ta || !onCaretMove) return
    onCaretMove(ta.value.slice(0, ta.selectionStart).split('\n').length)
  }

  return (
    <div className="editor-pane" ref={paneRef}>
      <div className="editor-gutter" aria-hidden>
        {lines.map((_, i) => (
          <div key={i} className={'gln' + (i + 1 === activeLine ? ' cur' : '')}>
            {i + 1}
          </div>
        ))}
      </div>
      <div className="editor-area">
        <pre className={'editor-highlight' + (highlight ? '' : ' plain')} aria-hidden ref={preRef}>
          {lines.map((raw, i) => {
            const toks = tokenizeLine(raw)
            return (
              <div key={i} className={'hl-line' + (i + 1 === activeLine ? ' cur' : '')}>
                {toks.length === 0
                  ? ' '
                  : toks.map((t, j) => (
                      <span key={j} className={t.cls}>
                        {t.text}
                      </span>
                    ))}
              </div>
            )
          })}
        </pre>
        <textarea
          ref={taRef}
          className="editor-textarea"
          value={source}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onSelect={reportCaret}
          onClick={reportCaret}
          onKeyUp={reportCaret}
          onContextMenu={(e) => {
            e.preventDefault()
            setCtx({ x: e.clientX, y: e.clientY })
          }}
        />
      </div>
      {ctx && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtx(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          />
          <ul
            className="ctx-menu"
            style={{ position: 'fixed', left: ctx.x, top: ctx.y, zIndex: 100 }}
            onClick={(e) => e.stopPropagation()}
          >
            {CTX_ITEMS.map(({ cmd, label }) => (
              <li key={cmd} onClick={() => { setCtx(null); runCmd(cmd) }}>{label}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
})
