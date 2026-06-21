# Kiny AST 规范

> 子项目：`engine/` parser 的产物契约　|　依据：`docs/reference/kin_spec_draft.md` v0.1.0
> 关联：`docs/reference/engine-m1-design.md`

AST 是 parser 与 runtime / analyze 之间的契约。本规范用 TypeScript 接口定义**所有节点形状**；"如何从文本解析出这些节点"由 parser 的实现计划承载，不在此处。

## 0. 设计要点

- AST 是**每文件**的解析产物。跨文件合并（全局命名空间、全局作用域）是 analyze 的职责，不在 AST 内体现。
- 名字解析（跳转目标指向哪个节点）、语义检查（重名、未声明变量、保留字、实参个数）也留给 analyze。AST 只忠实记录语法结构，名字与 JS 片段**原样保留为字符串**。
- **分支汇合不设独立节点**：选项体、`@if` 体是嵌套在各自元素内的 `ContentBlock`；"分支执行完后汇合到的后续内容"就是同一 `ContentBlock` 里排在该元素之后的兄弟元素。源码中的 `>` 层级在 AST 里被完全解析成嵌套，不再出现。
- 注释（`//`、`/* */`）不进 AST，解析时剥离。
- 每个节点带 `line`（1 起源码行号）用于错误报告。

## 1. 顶层结构

```ts
interface ProjectFile {
  path: string                 // 文件路径，用于错误信息
  preamble: ContentElement[]   // 第一个节点之前的内容（文件顶部全局逻辑行 ~ / ~~~）
  knots: Knot[]
}

interface Knot {
  kind: 'knot'
  name: string                 // 可中文，无空白
  params: string[]             // ASCII 标识符；无参为 []
  body: ContentBlock           // === 头之后到第一个子节点之间的正文
  stitches: Stitch[]
  line: number
  scope?: 'global'             // 'global' = analyze 合成的开场 knot（作用域为全局）；parser 产出的普通 knot 不设
}

interface Stitch {
  kind: 'stitch'
  name: string                 // 可中文，无空白
  body: ContentBlock
  line: number
}

type ContentBlock = ContentElement[]   // 一段正文 = 有序的内容元素序列
```

> `preamble` 中按语言规范只应出现逻辑行/注释；其它内容是否合法由 analyze 判定，parser 仍原样收入。

## 2. 内容元素

```ts
type ContentElement =
  | TextLine
  | Divert
  | ChoiceGroup
  | Conditional
  | LogicLine
  | LogicBlock
  | Command
```

### 2.1 TextLine —— 一行叙事文本

```ts
interface TextLine {
  kind: 'text'
  segments: InlineSegment[]    // 字面文本 + {插值}，转义已还原（§4）
  glue: boolean                // 行末是否有 <>
  line: number
}
```

行内 / 行末跳转不并入 TextLine：源码 `文本 -> 目标` 解析成相邻的 `[TextLine, Divert]`；`离开<> -> 目标` 解析成 `TextLine{glue:true}` 后接 `Divert`。

### 2.2 Divert —— 跳转

```ts
interface Divert {
  kind: 'divert'
  target: string               // 节点名 / '父.子' / 'END' / 'DONE'，原样保留
  args: string[]               // 带参跳转的 JS 实参表达式（§4.2 切分）；无参为 []
  line: number
}
```

目标名指向哪个节点、是否存在、实参个数是否匹配，均由 analyze 判定。

### 2.3 ChoiceGroup / Choice —— 选项

相邻的 `*` / `+` 行（含至多一个 fallback）成组：

```ts
interface ChoiceGroup {
  kind: 'choiceGroup'
  choices: Choice[]
  line: number
}

interface Choice {
  sticky: boolean              // * → false，+ → true
  fallback: boolean            // 形如 * -> 目标：无文本、无 {}、无 (label)
  condition: string | null     // {cond} 的 JS 源；无则 null
  label: string | null         // (label)；无则 null
  before: InlineSegment[]      // [ 之前的文本
  inner: InlineSegment[] | null// [...] 内的文本；null = 该选项无方括号
  after: InlineSegment[]       // ] 之后的文本
  resultDivert: Divert | null  // 选项行内联的 -> 目标
  body: ContentBlock           // > 分支体，可空
  line: number
}
```

文本派生规则（统一 spec §5.2 三种写法）：

| 源码 | before | inner | after | 显示文本 | 点击后印入正文 |
|---|---|---|---|---|---|
| `* 文本 -> 目标` | `文本` | `null` | `[]` | `before` | `before` |
| `* [显示] -> 目标` | `[]` | `显示` | `[]` | `before+inner` | `before+after`（空） |
| `* [显示] 正文 -> 目标` | `[]` | `显示` | `正文` | `before+inner` | `before+after` |

即：**显示文本 = `before + (inner ?? [])`；印入正文 = `before + after`**。

fallback 选项：`fallback:true`，`before`/`after` 为 `[]`，`inner` 为 `null`，`condition`/`label` 为 `null`，`resultDivert` 为目标，`body` 为 `[]`。

### 2.4 Conditional —— `@if` / `@elif` / `@else` 链

```ts
interface Conditional {
  kind: 'conditional'
  branches: ConditionalBranch[]
  line: number
}

interface ConditionalBranch {
  condition: string | null     // @if、@elif 为 JS 源；@else 为 null
  body: ContentBlock
  line: number
}
```

`branches[0]` 必为 `@if`（`condition` 非 null）；中间任意个 `@elif`（非 null）；末尾至多一个 `@else`（`condition` 为 null）。链后续内容即汇合点（§0）。

### 2.5 LogicLine / LogicBlock —— 嵌入 JS

```ts
interface LogicLine  { kind: 'logicLine';  code: string; line: number }                  // ~ 单行语句
interface LogicBlock { kind: 'logicBlock'; code: string; line: number; endLine: number } // ~~~ 多行块
```

`code` 为原始 JS 文本。`LogicBlock.code` 是起止 `~~~` 之间各行拼接（含换行），`endLine` 为收尾 `~~~` 的行号。

### 2.6 Command —— `@名字(...)` 内置命令

```ts
interface Command {
  kind: 'command'
  name: string                 // 如 'bg_show'
  args: string[]               // JS 实参表达式（§4.2 切分）
  line: number
}
```

`name` 是否属于内置命令集由 analyze 判定（§11.2）。

## 3. 行内片段 InlineSegment

```ts
type InlineSegment =
  | { kind: 'literal'; value: string }              // 字面文本，转义已还原
  | { kind: 'interp';  code: string; id: number }   // { JS 表达式 }，code 为原始 JS
```

`interp.code` 是 `{` 与 `}` 之间的原始 JS 表达式，内部不做转义处理。寻找配对 `}` 时对 JS 对象字面量 `{}` 做括号配平；`\{` / `\}` 不计入配对。

`interp.id` 是解析期分配的稳定整数标识，用于变体计数（§5）。

## 4. 转义还原

字面文本里下列转义在解析时还原为裸字符，存入 `literal.value`（spec §3.3）：

- 任意位置：`\{` `\}` `\<` `\/` `\\`
- 仅文本行首：`\=` `\*` `\+` `\>` `\~` `\@` `\->`
- 仅选项行内：`\[` `\]` `\(` `\)`

`interp.code` 内的 JS 不参与上述还原。

## 5. JS 实参切分与变体计数

**实参切分**（Divert、Command 的 `args`）：括号内原文按**顶层逗号**切分——跳过字符串字面量（`"…"` `'…'` `` `…` ``）与嵌套的 `()` `[]` `{}`，每段 trim 后是一条原始 JS 表达式；空括号得 `[]`。这保证 `@bg_show("a,b.jpg")`、`-> 商店("灯笼", 0.8)` 切出正确的参数个数供 analyze 校验。

**变体计数**（spec §9，`seq` / `cycle` / `once` / `shuffle`）：每个 `interp` 节点的稳定 `id` 用作计数键前缀。runtime 把每个变体计数器键为 `(interp.id, 本次求值中变体调用的序号)`——序号区分同一 `{}` 内的多个变体调用。变体按规范只承诺出现在 `{}` 插值，故仅 `interp` 携带 `id`；`~` / `~~~` / 条件 / 实参中的 JS 不是变体的承诺位置。

## 6. 边界

- AST 不含注释节点、不含 `>` 层级信息、不含空行（空行在解析时忽略，spec §3.1）。
- AST 不解析嵌入的 JS（`code`、`condition`、`args` 元素均为不透明字符串），JS 的执行是 runtime 的事。
- 名字解析、语义检查全部不在 AST，留给 analyze。
