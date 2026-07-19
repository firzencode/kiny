import type { Choice, ConditionalBranch, ContentBlock, ContentElement } from './ast'

/**
 * block 树访问器。各钩子按**深度优先、与手写递归逐字一致**的顺序触发：
 * 进入一个 block → `block(块)` → 逐元素 `element(el)` → 遇 `choiceGroup`/`conditional` 时，
 * 对每个 choice/branch 先调 `choice`/`branch`（取下钻用的子语境）再递归其 body。
 *
 * 语境 `C` 沿树向下线程化（宿主 knot / 作用域 / 路径等）：`choice`/`branch` 返回下钻子块时的语境，
 * 缺省沿用父语境。**choice 的触发顺序即 enumerateChoices 的枚举序**——决定存档 choice 序号与指纹，
 * 改动务必保持此顺序。
 */
export interface BlockVisitor<C> {
  /** 进入每个 block（含起始 block）时调用一次。 */
  block?(block: ContentBlock, ctx: C): void
  /** 遍历 block 每个直属元素时调用（choiceGroup/conditional 的下钻由本函数负责，不必在此手动递归）。 */
  element?(el: ContentElement, ctx: C): void
  /** 每个 choice：下钻其 body 前调用，返回 body 的子语境（缺省沿用父语境）。`via` 为所在元素下标、`index` 为 choice 下标。 */
  choice?(choice: Choice, via: number, index: number, ctx: C): C
  /** 每个 conditional 分支：下钻其 body 前调用，返回 body 的子语境（缺省沿用父语境）。 */
  branch?(branch: ConditionalBranch, via: number, index: number, ctx: C): C
}

/** 深度优先遍历 `root` 及其嵌套 choiceGroup/conditional 的所有后代 block。见 {@link BlockVisitor} 的顺序契约。 */
export function visitBlockTree<C>(root: ContentBlock, ctx: C, v: BlockVisitor<C>): void {
  v.block?.(root, ctx)
  root.forEach((el, via) => {
    v.element?.(el, ctx)
    if (el.kind === 'choiceGroup') {
      el.choices.forEach((c, index) => {
        const child = v.choice ? v.choice(c, via, index, ctx) : ctx
        visitBlockTree(c.body, child, v)
      })
    } else if (el.kind === 'conditional') {
      el.branches.forEach((b, index) => {
        const child = v.branch ? v.branch(b, via, index, ctx) : ctx
        visitBlockTree(b.body, child, v)
      })
    }
  })
}
