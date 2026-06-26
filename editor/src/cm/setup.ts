/**
 * 组装 Kin 编辑器的 CM6 扩展集 + 受控接线。host（EditorPane）只管挂 view、回灌 value。
 *
 * - 受控接线：外部回灌的事务打 `External` annotation，updateListener 见标记不回调 onChange，
 *   斩断「回灌→onChange→setState→回灌」回环（spike 验过，见 docs/memory/cm6-spike-findings.md）。
 * - 语义着色走 `highlightCompartment`，view 菜单的 highlight 开关用它热切换。
 * - goto：F12 或 Ctrl/Cmd-点击 `-> 目标` → 解析定义位置，交回 React（跨文件开 tab）。
 */
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor,
} from '@codemirror/view'
import { EditorState, Compartment, Annotation, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  syntaxHighlighting, foldGutter, codeFolding, foldKeymap, bracketMatching,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { kinLanguage } from './kinLanguage'
import { kinHighlightStyle } from './highlight'
import { kinTheme } from './theme'
import { kinContextField, getKinContext } from './context'
import { kinCompletionSource } from './complete'
import { kinFoldService, gotoTargetAt } from './navigate'

/** 外部回灌事务的标记：updateListener 见之即跳过 onChange（斩回环）。 */
export const External = Annotation.define<boolean>()

/** 语义着色的 compartment（view 菜单 highlight 开关热切换）。 */
export const highlightCompartment = new Compartment()

/** highlight 开 = 语义着色；关 = 空（纯文本，退回 --s-text）。 */
export function highlightExtensionFor(on: boolean): Extension {
  return on ? syntaxHighlighting(kinHighlightStyle) : []
}

export interface KinEditorCallbacks {
  /** 用户编辑（非外部回灌）导致文档变化。 */
  onChange: (value: string) => void
  /** 光标所在行变化（1 起），驱动 Outline 高亮。 */
  onCaretLine: (line: number) => void
  /** 请求跳到某文件某行的节点定义（跨文件由 React 开 tab）。 */
  onGoto: (file: string, line: number) => void
}

function gotoAt(view: EditorView, pos: number, cb: KinEditorCallbacks): boolean {
  const target = gotoTargetAt(view.state, pos, getKinContext(view.state).program)
  if (!target) return false
  cb.onGoto(target.file, target.line)
  return true
}

export function kinSetup(cb: KinEditorCallbacks, highlightOn: boolean): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    closeBrackets(),
    codeFolding(),
    foldGutter(),
    kinFoldService,
    highlightSelectionMatches(),
    lintGutter(),
    kinLanguage,
    highlightCompartment.of(highlightExtensionFor(highlightOn)),
    kinContextField,
    autocompletion({ override: [kinCompletionSource] }),
    kinTheme,
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
      { key: 'F12', run: (v) => gotoAt(v, v.state.selection.main.head, cb) },
      { key: 'Mod-b', run: (v) => gotoAt(v, v.state.selection.main.head, cb) },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        // Ctrl/Cmd-点击 -> 目标：goto-definition
        if (!(event.ctrlKey || event.metaKey)) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false
        if (gotoAt(view, pos, cb)) {
          event.preventDefault()
          return true
        }
        return false
      },
    }),
    EditorView.updateListener.of((u) => {
      const external = u.transactions.some((tr) => tr.annotation(External))
      if (u.docChanged && !external) cb.onChange(u.state.doc.toString())
      if ((u.selectionSet || u.docChanged) && !external) {
        cb.onCaretLine(u.state.doc.lineAt(u.state.selection.main.head).number)
      }
    }),
  ]
}
