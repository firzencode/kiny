import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { selectAll as cmSelectAll } from '@codemirror/commands'
import { setDiagnostics } from '@codemirror/lint'
import type { ValidatedProgram, Diagnostic as KinDiagnostic } from '@kiny/engine'
import { kinSetup, External, highlightCompartment, highlightExtensionFor } from '../cm/setup'
import { setKinContext } from '../cm/context'
import { toCmDiagnostics } from '../cm/lint'
import { readClipboardText } from '../clipboard'

export interface EditorHandle {
  exec(cmd: 'cut' | 'copy' | 'paste' | 'selectAll'): void
  focus(): void
}

interface EditorPaneProps {
  source: string
  onChange: (next: string) => void
  /** 外部请求把光标移到某行（Outline / 诊断跳转），1 起；null 不动。一次性：消费后经 onCaretConsumed 清零。 */
  caretLine: number | null
  /** caretLine 已被消费（移过光标）后回调，让 App 清回 null——避免切档重挂时旧行号把新文件光标拽走。 */
  onCaretConsumed?: () => void
  onCaretMove?: (line: number) => void
  /** 跳转目标在别的文件时，请求 React 开 tab 并定位。 */
  onGoto?: (file: string, line: number) => void
  /** 当前文件的 engine 诊断（画成行内波浪线）。 */
  diagnostics?: readonly KinDiagnostic[]
  /** 校验产出的符号表（补全 / 跳转用）。 */
  program?: ValidatedProgram | null
  /** 当前活动文件路径（补全 / 跳转上下文）。 */
  activeFile?: string | null
  /** 关闭语义着色（视图菜单）。默认 true。 */
  highlight?: boolean
}

/**
 * 编辑区：CodeMirror 6 的薄 host。挂 `EditorView`、做受控接线（外部 value 回灌打 External
 * 标记斩回环），把 React 侧的诊断 / 符号表 / 活动文件喂进 CM 扩展。语义着色、行内波浪线、
 * 补全、跳转、折叠、查找替换、多光标、撤销、IME、原生剪贴板均由 CM6 扩展提供。
 */
export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { source, onChange, caretLine, onCaretConsumed, onCaretMove, onGoto, diagnostics, program, activeFile, highlight = true },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 回调放 ref：扩展只在挂载时装一次，内部经 ref 取最新 handler，避免重建 view。
  const cbRef = useRef({ onChange, onCaretMove, onGoto })
  cbRef.current = { onChange, onCaretMove, onGoto }
  // caretLine 消费回调单独放 ref：caretLine effect 只依赖 [caretLine]，经 ref 取最新避免 stale。
  const onCaretConsumedRef = useRef(onCaretConsumed)
  onCaretConsumedRef.current = onCaretConsumed

  // 挂载：建 EditorView（仅一次）。
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: source,
        extensions: kinSetup(
          {
            onChange: (v) => cbRef.current.onChange(v),
            onCaretLine: (l) => cbRef.current.onCaretMove?.(l),
            onGoto: (f, l) => cbRef.current.onGoto?.(f, l),
          },
          highlight,
        ),
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅挂载一次；source/highlight 初值已用，后续变化由下方 effect 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 受控回灌：外部 source 变化 → 用 External 标记的事务同步进 doc（同值不 dispatch）。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() === source) return
    const sel = view.state.selection
    const len = source.length
    const clamp = (n: number) => Math.min(n, len)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
      selection: { anchor: clamp(sel.main.anchor), head: clamp(sel.main.head) },
      annotations: External.of(true),
    })
  }, [source])

  // 诊断回灌：当前文件诊断 → CM6 行内波浪线。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(setDiagnostics(view.state, toCmDiagnostics(diagnostics ?? [], view.state.doc)))
  }, [diagnostics])

  // 符号表 / 活动文件回灌：补全 / 跳转读取。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setKinContext.of({ program: program ?? null, activeFile: activeFile ?? null }) })
  }, [program, activeFile])

  // 语义着色开关：热切换 highlight compartment。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: highlightCompartment.reconfigure(highlightExtensionFor(highlight)) })
  }, [highlight])

  // 外部请求移光标到某行（Outline / 诊断跳转）。一次性：消费后通知 App 清回 null，
  // 否则切档重挂时这个常驻行号会把新文件光标拽到旧行。
  useEffect(() => {
    if (caretLine == null) return
    const view = viewRef.current
    if (view != null && caretLine >= 1 && caretLine <= view.state.doc.lines) {
      const line = view.state.doc.line(caretLine)
      view.focus()
      view.dispatch({
        selection: { anchor: line.from, head: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      })
    }
    onCaretConsumedRef.current?.()
  }, [caretLine])

  const pasteFromClipboard = async () => {
    const view = viewRef.current
    if (!view) return
    view.focus()
    let text = ''
    try {
      text = await readClipboardText()
    } catch {
      return /* 剪贴板不可读：忽略，键盘 Ctrl+V 仍可用 */
    }
    if (!text) return
    view.dispatch(view.state.replaceSelection(text))
  }

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus()
    },
    exec(cmd) {
      const view = viewRef.current
      if (!view) return
      view.focus()
      if (cmd === 'selectAll') {
        cmSelectAll(view)
        return
      }
      if (cmd === 'paste') {
        void pasteFromClipboard()
        return
      }
      // cut / copy：CM6 内容是 contenteditable，execCommand 作用于当前选区。
      try {
        document.execCommand(cmd)
      } catch {
        /* 部分环境不支持：忽略（键盘快捷键仍可用） */
      }
    },
  }))

  return <div className="editor-pane" ref={hostRef} />
})
