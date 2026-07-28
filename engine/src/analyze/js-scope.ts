import { parse as acornParse } from 'acorn'
import { forEachChild, collectPatternNames, type AstNode } from '../js-ast'

/** 一处对 `$nodes` 的字面成员访问：path 为字面链（`商店` / `商店.内室`），argc 为字面调用实参数（非调用 null）。 */
export interface NodesAccess {
  path: string
  argc: number | null
}

export interface JsAnalysis {
  declares: string[]
  references: string[]
  /** 自由（非局部绑定）标识符的赋值目标：`random = 5` / `random++`——供检测「给内置函数赋值」。 */
  assigns: string[]
  /** `$nodes` 的字面成员访问（编译期可校验存在性 / arity 的部分；计算下标不记）。 */
  nodesAccess: NodesAccess[]
}

/**
 * 分析一个 JS 片段。
 * - expr：插值 / 条件 / 实参，包一层括号解析（避免 `{...}` 被当块语句）。
 * - stmt：`~` 行 / `~~~` 块，按 Program 解析。
 * 返回顶层声明名与自由引用名；解析失败返回 { error }。
 */
export function analyzeJs(code: string, mode: 'expr' | 'stmt'): JsAnalysis | { error: string } {
  let program: AstNode
  try {
    const src = mode === 'expr' ? `(${code})` : code
    program = acornParse(src, { ecmaVersion: 'latest' }) as AstNode
  } catch (e) {
    return { error: (e as Error).message }
  }

  const references = new Set<string>()
  const assigns = new Set<string>()
  const nodesAccess: NodesAccess[] = []
  const scopes: Set<string>[] = [new Set<string>()]
  const top = scopes[0]!
  const isBound = (name: string) => scopes.some((s) => s.has(name))

  /** 成员节点的属性名：非 computed 取标识符名；computed 只认字符串字面量；其余（动态）null。 */
  const propNameOf = (m: AstNode): string | null => {
    if (!m.computed) return m.property.type === 'Identifier' ? (m.property.name as string) : null
    const p = m.property
    return p.type === 'Literal' && typeof p.value === 'string' ? p.value : null
  }

  /**
   * 尝试把一个 MemberExpression 解析成 `$nodes` 字面链（一级 `$nodes.X` / 二级 `$nodes.X.Y`），
   * 返回完整路径；非 $nodes 链或含动态环节返回 null（交默认遍历，内层一级链会再被访问到）。
   */
  const nodesMemberPath = (node: AstNode): string | null => {
    const obj = node.object
    if (obj.type === 'Identifier' && obj.name === '$nodes' && !isBound('$nodes')) {
      return propNameOf(node) // 一级：`$nodes.X` / `$nodes["X"]`（可含带点全路径）
    }
    if (
      obj.type === 'MemberExpression' &&
      obj.object.type === 'Identifier' &&
      obj.object.name === '$nodes' &&
      !isBound('$nodes')
    ) {
      const parent = propNameOf(obj)
      const child = propNameOf(node)
      if (parent !== null && child !== null) return `${parent}.${child}` // 二级：`$nodes.X.Y`
    }
    return null
  }

  /** 收模式绑定名进 target（不求值默认值）；var/function 提升与顶层声明收集用。 */
  const collectNames = (p: AstNode, target: Set<string>): void =>
    collectPatternNames(p, (n) => target.add(n))

  /**
   * var / function 声明提升：把一段语句里（含嵌套块，但**不下钻**嵌套函数/类体）的 `var` 绑定名与
   * `function` 声明名收进 target（=最近函数作用域）。使 `function g(){ if(1){var x=1} return x }` 里
   * `x` 在整个函数作用域可见——匹配 JS 的 var 提升语义，消除 B1 误报。let/const/class 是块级、不提升。
   */
  function hoist(statements: AstNode[], target: Set<string>): void {
    for (const s of statements) hoistStmt(s, target)
  }
  function hoistStmt(s: AstNode, target: Set<string>): void {
    if (!s || typeof s.type !== 'string') return
    switch (s.type) {
      case 'VariableDeclaration':
        if (s.kind === 'var') for (const d of s.declarations) collectNames(d.id, target)
        return
      case 'FunctionDeclaration': target.add(s.id.name); return
      case 'BlockStatement': hoist(s.body, target); return
      case 'IfStatement': hoistStmt(s.consequent, target); hoistStmt(s.alternate, target); return
      case 'ForStatement': hoistStmt(s.init, target); hoistStmt(s.body, target); return
      case 'ForInStatement':
      case 'ForOfStatement': hoistStmt(s.left, target); hoistStmt(s.body, target); return
      case 'WhileStatement':
      case 'DoWhileStatement': hoistStmt(s.body, target); return
      case 'TryStatement':
        hoist(s.block.body, target)
        if (s.handler) hoist(s.handler.body.body, target)
        if (s.finalizer) hoist(s.finalizer.body, target)
        return
      case 'SwitchStatement': for (const c of s.cases) hoist(c.consequent, target); return
      case 'LabeledStatement': hoistStmt(s.body, target); return
      // 其余（表达式语句 / return / 嵌套函数·类声明体）：var 不下钻，忽略。
    }
  }

  function bindPattern(p: AstNode, target: Set<string>): void {
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

  function visitFunction(node: AstNode): void {
    const local = new Set<string>()
    if (node.id && node.type !== 'FunctionDeclaration') local.add(node.id.name)
    // 先 push 再逐参绑定：使参数默认值可引用前序参数（`(a, b = a) => b` 合法，B1 修复）。
    scopes.push(local)
    for (const param of node.params) bindPattern(param, local)
    if (node.body.type === 'BlockStatement') {
      hoist(node.body.body, local) // var/function 提升到函数作用域
      for (const s of node.body.body) visit(s)
    } else {
      visit(node.body) // 箭头函数表达式体
    }
    scopes.pop()
  }

  function visitClass(node: AstNode): void {
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

  function visit(node: AstNode | null | undefined): void {
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
      case 'AssignmentExpression':
        // 裸标识符赋值目标若非局部绑定 → 记为自由引用 + 自由赋值（供检测给内置函数赋值 A7）。
        if (node.left.type === 'Identifier') {
          if (!isBound(node.left.name)) { references.add(node.left.name); assigns.add(node.left.name) }
        } else visit(node.left)
        visit(node.right)
        return
      case 'UpdateExpression': // random++ / --random
        if (node.argument.type === 'Identifier') {
          if (!isBound(node.argument.name)) { references.add(node.argument.name); assigns.add(node.argument.name) }
        } else visit(node.argument)
        return
      case 'CallExpression': {
        // `$nodes.X(...)` 字面调用：记 path + argc（callee 已消费，不再当普通成员访问重复记）。
        if (node.callee.type === 'MemberExpression') {
          const path = nodesMemberPath(node.callee)
          if (path !== null) {
            nodesAccess.push({ path, argc: node.arguments.length })
            for (const a of node.arguments) visit(a)
            return
          }
        }
        forEachChild(node, visit)
        return
      }
      case 'MemberExpression': {
        const path = nodesMemberPath(node)
        if (path !== null) {
          nodesAccess.push({ path, argc: null })
          return // 字面链已整体消费（属性为字面量，无自由引用可下钻）
        }
        visit(node.object)
        if (node.computed) visit(node.property)
        return
      }
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
        forEachChild(node, visit)
    }
  }

  // declares = **仅顶层**声明名（let/const/var/function/class）——它们经 topDeclares 导出/持久化到
  // G/L 供跨片段可见（须与运行期 env.ts topDeclares 的顶层语义一致）。嵌套 var 是片段局部、不导出。
  const declaredTop = new Set<string>()
  for (const stmt of program.body) {
    if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) collectNames(d.id, declaredTop)
    else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') declaredTop.add(stmt.id.name)
  }
  const declares = [...declaredTop]

  // 作用域绑定 top（用于引用解析，非导出）：顶层声明 + 提升的（含嵌套块内）var/function。
  for (const n of declaredTop) top.add(n)
  hoist(program.body, top)

  for (const stmt of program.body) visit(stmt)

  return { declares, references: [...references], assigns: [...assigns], nodesAccess }
}
