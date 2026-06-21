# Kiny RawBlock 规范

> 子项目：`engine/` parser pass 2 的产物契约　|　最终契约：`docs/reference/engine-ast-spec.md`
> 关联：`docs/reference/engine-parser-spec.md` §4（块趟算法）

RawBlock 是 parser **pass 2（块趟）** 的产物、**pass 3（行内趟）** 的输入。它已把 `>` 层级折叠成嵌套结构、相邻选项成组、`@if` 链成型，但叶子的文本/条件/标签/实参等**仍是原始字符串**，留给 pass 3 精解析成最终 AST（`docs/reference/engine-ast-spec.md`）。

RawBlock 是 parser 内部中间表示，不对外暴露最终 API。

## 0. 设计要点

- pass 2 **只认结构**：按行首 token 分类、用 `>` 建嵌套、把相邻选项归组、把 `@if/@elif/@else` 串成链。**不拆任何细粒度内容**——选项的条件/标签/文本、`@if` 的条件、命令/跳转的实参，全留原文给 pass 3。
- 汇合（branch 执行完回到外层后续内容）以**序列顺序**隐式表示，与最终 AST 一致（`engine-ast-spec.md` §0）：分支体是嵌套的 `RawBlock`，其后的兄弟元素即汇合内容。
- 每个元素带 `line`（1 起源码行号）。
- 叶子分类完整：text/divert/command/logicLine/logicBlock 各有独立 `kind`，pass 3 据此选解析器，无需再分类。

## 1. RawFile —— pass 2 的文件级产物

镜像 `FileSkeleton`（pass 1 产物），但 `preamble` 与各 `body` 从 `SourceLine[]` 折叠成 `RawBlock`：

```ts
interface RawFile {
  path: string
  preamble: RawBlock
  knots: RawKnot[]
}

interface RawKnot {
  name: string
  params: string[]
  body: RawBlock
  stitches: RawStitch[]
  line: number
}

interface RawStitch {
  name: string
  body: RawBlock
  line: number
}
```

## 2. RawBlock 与元素

```ts
type RawBlock = RawElement[]

type RawElement =
  | RawText
  | RawDivert
  | RawCommand
  | RawLogicLine
  | RawLogicBlock
  | RawChoiceGroup
  | RawConditional
```

### 2.1 叶子元素

```ts
interface RawText      { kind: 'text';       raw: string; line: number }   // 去 > 后的整行内容
interface RawDivert    { kind: 'divert';     raw: string; line: number }   // 内容以 -> 起首
interface RawCommand   { kind: 'command';    raw: string; line: number }   // 内容以 @名字 起首（非 @if/@elif/@else）
interface RawLogicLine { kind: 'logicLine';  code: string; line: number }  // `~` 之后的内容
interface RawLogicBlock{ kind: 'logicBlock'; code: string; line: number; endLine: number }
```

- `RawText` / `RawDivert` / `RawCommand` 形状相同，靠 `kind` 区分；`raw` 是去掉 `>` 层级前缀后的整行内容（保留各自的行首标记 `->` / `@`，由 pass 3 解析）。pass 3 负责：文本→`InlineSegment[]`、跳转→目标+实参切分、命令→`name`+实参切分。
- `RawLogicLine.code` 是 `~` 之后的原始 JS。
- `RawLogicBlock` **仅出现在 level 0**（节点/子节点正文顶层，不在任何 `>` 体内）；`code` 是起止 `~~~` 之间各行逐字拼接（含换行、含空行），`endLine` 为收尾 `~~~` 行号。

### 2.2 选项组

```ts
interface RawChoiceGroup { kind: 'choiceGroup'; choices: RawChoice[]; line: number }

interface RawChoice {
  sticky: boolean       // `*` → false，`+` → true
  raw: string           // `*`/`+` 之后的整段（条件 {}、标签 ()、文本、行末 -> 都在内）
  body: RawBlock        // > 分支体，可空
  line: number
}
```

相邻、同层的 `*`/`+` 行归入同一个 `RawChoiceGroup`；遇到非选项的同层行即结束该组。`raw` 的细解析（fallback 判定、条件、标签、`before/inner/after`、`resultDivert`）由 pass 3 完成。

### 2.3 条件链

```ts
interface RawConditional { kind: 'conditional'; branches: RawBranch[]; line: number }

interface RawBranch {
  selector: 'if' | 'elif' | 'else'
  raw: string           // 关键字之后的内容（if/elif 含 {cond}；else 为 ''）
  body: RawBlock
  line: number
}
```

`branches[0].selector` 必为 `'if'`；中间任意个 `'elif'`；末尾至多一个 `'else'`。pass 3 从 `raw` 取出 `{cond}` 作为条件（`else` 无条件）。

## 3. 边界

- 不解析任何叶子细节（`raw`/`code` 为不透明字符串）。
- 不做语义检查（节点存在性、变量、实参个数等属 analyze）。
- 折叠算法（`>` 层级 → 层级、分类、成组、链、汇合、错误清单）见 `docs/reference/engine-parser-spec.md` §4。
