import { parse as acornParse } from 'acorn'

export interface JsAnalysis {
  declares: string[]
  references: string[]
}

// acorn 节点结构松散，这里用 any 做递归走查；仅读 .type 与已知子字段。
type N = any

/**
 * 分析一个 JS 片段。
 * - expr：插值 / 条件 / 实参，包一层括号解析（避免 `{...}` 被当块语句）。
 * - stmt：`~` 行 / `~~~` 块，按 Program 解析。
 * 返回顶层声明名与自由引用名；解析失败返回 { error }。
 */
export function analyzeJs(code: string, mode: 'expr' | 'stmt'): JsAnalysis | { error: string } {
  let program: N
  try {
    const src = mode === 'expr' ? `(${code})` : code
    program = acornParse(src, { ecmaVersion: 'latest' })
  } catch (e) {
    return { error: (e as Error).message }
  }

  const references = new Set<string>()
  const scopes: Set<string>[] = [new Set<string>()]
  const top = scopes[0]!
  const isBound = (name: string) => scopes.some((s) => s.has(name))

  function bindPattern(p: N, target: Set<string>): void {
    if (!p) return
    switch (p.type) {
      case 'Identifier':
        target.add(p.name)
        break
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') bindPattern(prop.argument, target)
          else {
            if (prop.computed) visit(prop.key)
            bindPattern(prop.value, target)
          }
        }
        break
      case 'ArrayPattern':
        for (const el of p.elements) bindPattern(el, target)
        break
      case 'AssignmentPattern':
        bindPattern(p.left, target)
        visit(p.right)
        break
      case 'RestElement':
        bindPattern(p.argument, target)
        break
    }
  }

  function visitFunction(node: N): void {
    const local = new Set<string>()
    if (node.id && node.type !== 'FunctionDeclaration') local.add(node.id.name)
    for (const param of node.params) bindPattern(param, local)
    scopes.push(local)
    if (node.body.type === 'BlockStatement') for (const s of node.body.body) visit(s)
    else visit(node.body) // 箭头函数表达式体
    scopes.pop()
  }

  function visitClass(node: N): void {
    if (node.superClass) visit(node.superClass)
    const local = new Set<string>()
    if (node.id) local.add(node.id.name) // 类名在其自身体内可见
    scopes.push(local)
    for (const m of node.body.body) {
      if (m.type === 'StaticBlock') {
        for (const s of m.body) visit(s)
        continue
      }
      if (m.computed) visit(m.key) // 计算属性名可能引用变量
      if (m.value) visit(m.value) // 方法体 / 字段初始化
    }
    scopes.pop()
  }

  function visit(node: N): void {
    if (!node || typeof node.type !== 'string') return
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          bindPattern(d.id, scopes[scopes.length - 1]!)
          if (d.init) visit(d.init)
        }
        return
      case 'FunctionDeclaration':
        scopes[scopes.length - 1]!.add(node.id.name)
        visitFunction(node)
        return
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        visitFunction(node)
        return
      case 'ClassDeclaration':
        scopes[scopes.length - 1]!.add(node.id.name)
        visitClass(node)
        return
      case 'ClassExpression':
        visitClass(node)
        return
      case 'CatchClause': {
        const local = new Set<string>()
        if (node.param) bindPattern(node.param, local)
        scopes.push(local)
        for (const s of node.body.body) visit(s)
        scopes.pop()
        return
      }
      case 'LabeledStatement':
        visit(node.body) // 跳过 node.label（不是引用）
        return
      case 'BreakStatement':
      case 'ContinueStatement':
        return // 跳过 node.label（不是引用）
      case 'MemberExpression':
        visit(node.object)
        if (node.computed) visit(node.property)
        return
      case 'Property':
        if (node.computed) visit(node.key)
        visit(node.value)
        return
      case 'Identifier':
        if (!isBound(node.name)) references.add(node.name)
        return
      case 'BlockStatement': {
        scopes.push(new Set<string>())
        for (const s of node.body) visit(s)
        scopes.pop()
        return
      }
      default:
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'start' || key === 'end') continue
          const val = node[key]
          if (Array.isArray(val)) for (const c of val) visit(c)
          else if (val && typeof val.type === 'string') visit(val)
        }
    }
  }

  // 先把顶层声明名提升进 top，使片段内前向引用（如函数互相调用）不被误判为自由引用。
  for (const stmt of program.body) {
    if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) bindPattern(d.id, top)
    else if (stmt.type === 'FunctionDeclaration') top.add(stmt.id.name)
    else if (stmt.type === 'ClassDeclaration') top.add(stmt.id.name)
  }
  const declares = [...top]

  for (const stmt of program.body) visit(stmt)

  return { declares, references: [...references] }
}
