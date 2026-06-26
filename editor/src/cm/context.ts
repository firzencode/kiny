/**
 * CM6 侧的 Kin 上下文：持有校验结果（符号表）与当前活动文件，供补全 / 跳转读取。
 *
 * 不在 CM 里重跑 analyze——editor 的中央增量校验（useDebouncedValidation）产出
 * `ValidatedProgram` 后，React 用 `setKinContext` effect 推进来。complete.ts / navigate.ts
 * 只从这个 field 读，故与 React 解耦、可独立单测。节点表按需从 doc 现算（parseNodes）。
 */
import { StateField, StateEffect, type EditorState } from '@codemirror/state'
import type { ValidatedProgram } from '@kiny/engine'

export interface KinContext {
  program: ValidatedProgram | null
  activeFile: string | null
}

const EMPTY: KinContext = { program: null, activeFile: null }

export const setKinContext = StateEffect.define<KinContext>()

export const kinContextField = StateField.define<KinContext>({
  create: () => EMPTY,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setKinContext)) return e.value
    return value
  },
})

export function getKinContext(state: EditorState): KinContext {
  return state.field(kinContextField, false) ?? EMPTY
}
