import type { Node } from 'acorn'

/**
 * acorn 节点的松散视图：`type`/`start`/`end` 保留 acorn 的静态类型，其余子字段按 `any` 读取
 * （AST 形状随节点种类而异，逐一建模不划算）。以此替代裸 `any`——变量至少被约束为一个 acorn 节点。
 */
export type AstNode = Node & Record<string, any>

/**
 * 通用兜底走查：递归 `node` 的所有子节点——数组字段逐元素、对象字段若带 `.type` 则下钻，
 * 跳过 `type`/`start`/`end` 元字段。调用方在其 visitor 里对关心的节点种类特判、其余交给本函数。
 */
export function forEachChild(node: AstNode, visit: (child: AstNode) => void): void {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const val = node[key]
    if (Array.isArray(val)) {
      for (const c of val) if (c && typeof c.type === 'string') visit(c)
    } else if (val && typeof val.type === 'string') {
      visit(val)
    }
  }
}

/**
 * 收集一个绑定模式里的全部绑定名（不求值默认值、不下钻计算键）：
 * `Identifier` / `ObjectPattern` / `ArrayPattern` / `AssignmentPattern` / `RestElement`。
 * 供顶层声明导出与 var/function 提升——两处语义相同，收敛到此。
 */
export function collectPatternNames(
  pattern: AstNode | null | undefined,
  add: (name: string) => void,
): void {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      add(pattern.name)
      break
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        collectPatternNames(prop.type === 'RestElement' ? prop.argument : prop.value, add)
      }
      break
    case 'ArrayPattern':
      for (const el of pattern.elements) collectPatternNames(el, add)
      break
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, add)
      break
    case 'RestElement':
      collectPatternNames(pattern.argument, add)
      break
  }
}
