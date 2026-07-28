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
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands'
import type { KeyBinding } from '@codemirror/view'
import { dispatchMap, type Overrides } from '../shortcuts/bindings'
import { toCmKey } from '../shortcuts/keys'
import type { CommandId } from '../shortcuts/registry'
import {
  syntaxHighlighting, foldGutter, codeFolding, foldKeymap, bracketMatching,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { languageCompartment, languageFor } from './langs'
import { kinHighlightStyle } from './highlight'
import { kinTheme } from './theme'
import { kinContextField, getKinContext } from './context'
import { kinCompletionSource } from './complete'
import { kinFoldService, gotoTargetAt } from './navigate'

/** 外部回灌事务的标记：updateListener 见之即跳过 onChange（斩回环）。 */
export const External = Annotation.define<boolean>()

/** 语义着色的 compartment（view 菜单 highlight 开关热切换）。 */
export const highlightCompartment = new Compartment()

/** editor 域快捷键的 compartment（快捷键设置页改绑定时热更）。 */
export const shortcutsCompartment = new Compartment()

/** 只读态 compartment（AI 运行期把编辑区置只读，热切换）。 */
export const readonlyCompartment = new Compartment()

/** 只读 = 禁止编辑输入（内容不可改），但选中 / 滚动 / 复制不受限。 */
export function readonlyExtensionFor(on: boolean): Extension {
  return on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
}

/** CM 命令注册表：editor 域命令 id → CM Command（部分——只有可绑的 editor 命令有实现）。 */
const EDITOR_COMMANDS: Partial<Record<CommandId, KeyBinding['run']>> = { toggleComment }

/** 由生效绑定构建 editor 域 keymap（覆盖变更时经 compartment 重配）。 */
export function editorKeymapFor(overrides: Overrides = {}): Extension {
  const bindings: KeyBinding[] = []
  for (const [keys, id] of dispatchMap('editor', overrides)) {
    const run = EDITOR_COMMANDS[id]
    if (run) bindings.push({ key: toCmKey(keys), run })
  }
  // 高优先级：置于 defaultKeymap 之前，让注册表成为 editor 域绑定的唯一真相源。
  return keymap.of(bindings)
}

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

export function kinSetup(
  cb: KinEditorCallbacks,
  highlightOn: boolean,
  shortcuts: Overrides = {},
  readOnly = false,
  path: string | null = null,
): Extension[] {
  return [
    readonlyCompartment.of(readonlyExtensionFor(readOnly)),
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
    // 语言按扩展名选（.kin 走 Kin 语言，作品前端资源走对应 CM6 语言包），随切档热切换。
    languageCompartment.of(languageFor(path)),
    highlightCompartment.of(highlightExtensionFor(highlightOn)),
    kinContextField,
    autocompletion({ override: [kinCompletionSource] }),
    kinTheme,
    EditorView.lineWrapping,
    // editor 域快捷键（注册表驱动，可重配）——置于 defaultKeymap 前取更高优先级。
    shortcutsCompartment.of(editorKeymapFor(shortcuts)),
    keymap.of([
      ...closeBracketsKeymap,
      // 摘掉 defaultKeymap 自带的 Mod-/ → toggleComment，改由注册表 compartment 统管（可自定义）。
      ...defaultKeymap.filter((b) => b.key !== 'Mod-/'),
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
