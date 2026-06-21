# Kiny Parser 规范

> 子项目：`engine/` parser　|　产物契约：`docs/reference/engine-ast-spec.md`　|　依据：`docs/reference/kin_spec_draft.md` v0.1.0
> 关联：`docs/reference/engine-m1-design.md`

parser 把一个 `.kin` 文件的文本解析成 `ProjectFile` AST（形状见 AST 规范）。本规范定义解析的**架构、每趟职责、核心算法、错误与测试策略**；AST 的字段语义不在此重复。

## 0. 设计决策

- **分层三趟 + 注释预趟**：`pass 0` 注释 → `pass 1` 结构 → `pass 2` 块 → `pass 3` 行内。每趟契约清晰、独立可测。
- **fail-fast**：遇到第一个语法错误即抛 `ParseError`（带 1 起行号与文件路径）。多错收集留待编辑器阶段，不在 M1。
- **只管语法**：名字解析、语义检查（重名、未声明变量、保留字、实参个数、未知命令、跨文件合并）全部属于 analyze，不在 parser。
- parser 内部在 `pass 2` 与 `pass 3` 之间用一层 **RawBlock** 中间表示（结构已成型、叶子仍是原始字符串），不对外暴露。

## 1. 流水线

```
text
 ├ pass 0  注释预趟  去掉 Kiny 注释，注释处替换空白、行号不变       → text'
 ├ pass 1  结构趟    knots/stitches 骨架，每个挂原始 body 行         → ProjectFile 骨架(body 为 SourceLine[])
 ├ pass 2  块趟      > 层级建嵌套 + 选项成组 + @if 链               → RawBlock 树
 └ pass 3  行内趟    每个原始字符串精解析成 InlineSegment/args/...   → ProjectFile(完整 AST)
```

`pass 0`–`pass 2` 的产物是中间形态；`pass 3` 产出最终契约 AST。

## 2. pass 0 · 注释预趟

`stripComments(text, path): string`，纯文本→文本：把 Kiny 注释（`//`、`/* */`）替换为空格，**行数与行号完全不变**（块注释跨行时各行内容替空格、换行保留）。串在 pass 1 之前。

判据只有一句：**注释只在"叙事文本"里被剥；JS 区域一律不剥。**

### 2.1 JS 区域（扫描时跳过，不剥注释）

| 区域 | 边界 |
|---|---|
| `{ … }` 插值 | 到配平的 `}`；配平时识别字符串字面量（`"…"` `'…'` `` `…` ``），跳过串内的 `}`；`\{`/`\}` 不计 |
| 行末内联 `-> …` | 从未转义的 `->` 到行尾（跳转是行末终结结构，其后全是目标+实参） |
| `~` 行 | 整行（JS 语句；其 `//` 本就是 JS 注释，§7.7） |
| `~~~ … ~~~` 块 | 到闭合 fence（行级开关；fence 检测用未剥 `>` 的 `line.trim() === '~~~'`，因 `~~~` 限 level 0） |
| 命令行 `@名字(…)`（非 `@if`/`@elif`/`@else`） | 整行（命令独占一行、`)` 后无内容，§11.2） |

> `~` 行与命令行的豁免判定，对**剥掉行首 `>` 标记后的内容**（共享 `splitLevel`，见 §4.1）取首 token——于是分支体内的 `> ~ url="http://x"`、`> @bg("a//b")` 也正确整行豁免；`> -> 目标(…)` 由扫描规则中的行内 `->` 兜住。

### 2.2 被扫描的行与扫描规则

被扫描剥注释的行：文本、选项 `*`/`+`、分支 `>`、声明 `=`/`===`、`@if`/`@elif`/`@else`。逐字符扫描：

- `\` → 下一字符为字面（`\/` 不算注释起始，`\` 保留待 pass 3 还原）
- 未转义 `{` → 进入插值，跳到配平 `}`（见 §2.1）
- 未转义 `->` → 后半行整体豁免，停止本行剥离
- 插值外、未转义 `//` → 删到行尾
- 插值外、未转义 `/*` → 进入块注释（记起始行号），删到配平 `*/`（可跨行）

> 副作用：文本里的 `/*` 可跨过后续的 `===`/`~` 等行一直吃到 `*/`——块注释能注释掉整段（含节点），这正是 pass 0 必须跑在 pass 1 之前的原因。

### 2.3 边界与错误

- 叙事文本里要输出**字面** `//` 或 `/*`（如 URL `http://`）须按 §3.3 转义为 `\/`；这是语言转义规则，不是 pass 0 的额外限制。
- 未闭合的 `{` 插值不在 pass 0 报错（行尾重置插值状态），留给 pass 3。
- **错误**：块注释 `/*` 到文件末仍未闭合 → `ParseError`，行号指向 `/*` 起始行。

## 3. pass 1 · 结构趟

逐行（行已去注释）：

- 去首尾空白后以 `=` 起首（`\=` 起首不算，属正文）：
  - 前导恰好 1 个 `=` → 子节点 `= 名字`
  - 否则 → 节点 `=== 名字 ===`，校验左右各 3 个等号、名字非空且无空白、参数为 ASCII 标识符
- 其余行作原始 `SourceLine`（含空行）收入当前子节点 → 当前节点 → 否则文件 `preamble`

产出 `ProjectFile` 骨架：`knots` / `stitches` 已就位，各 `body` 为原始 `SourceLine[]`，待 pass 2 解析。

**错误**：节点头等号非 3/3；节点缺名字 / 名字含空格；参数缺右括号 / 参数名非 ASCII 标识符；子节点出现在任何节点之前。

## 4. pass 2 · 块趟

把 pass 1 骨架的每个 body（`SourceLine[]`）折叠成 `RawBlock`，整个骨架成为 `RawFile`。RawBlock/RawFile 的类型契约见 `docs/reference/engine-rawblock-spec.md`；pass 2 **只认结构、不拆叶子细节**，原文留给 pass 3。

### 4.1 层级

- 用共享的 `splitLevel(text) → { level, content }` 解析：去行首空白后数 `>` 标记，`>>>` 与 `> > >` 等价、`>` 后空白可选；`level` = 标记个数，`content` = 剥掉标记前缀后的内容。
- 行首 `\>` 不计为层级标记，整行是 0 层字面文本（`\>` 留在 `content`，由 pass 3 还原）。
- `splitLevel` 同时供 pass 0 用于判 `>`-前缀控制行的豁免（见 §2）。

### 4.2 内容分类（按 content 首 token）

| 首 token | 元素（RawElement） | pass 2 捕获 |
|---|---|---|
| `*` / `+` | `RawChoice`（入 `RawChoiceGroup`） | `sticky` + 标记之后整段 `raw` + `>` 体 |
| `@if` / `@elif` / `@else` | `RawBranch`（入 `RawConditional`） | `selector` + 关键字之后整段 `raw`（含 `{cond}`）+ `>` 体 |
| `~~~` | `RawLogicBlock` | **仅 level 0**；消费到闭合 fence，块内各行逐字拼接为 `code` |
| `~` | `RawLogicLine` | `~` 之后为 `code` |
| `@名字`（非 if/elif/else） | `RawCommand` | 整段 `raw`（`name` 与实参切分留给 pass 3） |
| `->` | `RawDivert` | 整段 `raw`（目标 + 实参留给 pass 3） |
| 其它 | `RawText` | 整段 `raw` |

### 4.3 嵌套、成组、链

- 选项 / `@if` 分支的 body = 紧随其后、层级为"标记层级 +1"的连续行。
- **相邻同层选项**（含至多一个 fallback 候选）归一个 `ChoiceGroup`。
- 同层 `@if` → `@elif`* → `@else`? 串成一条 `Conditional` 链。
- 层级回落 = 内层闭合；后续同层行成为该层的兄弟元素（即分支汇合后的内容）。

### 4.4 错误

- `>` 层级跳跃：某行层级超过当前可容纳深度（无对应的选项/`@if` 开启者）。
- `@elif`/`@else` 前无同层 `@if`。
- `@else` 非链尾，或链中出现多个 `@else`。
- `~~~` 出现在 level > 0（多行块只允许在节点/子节点正文顶层；体内多行逻辑请在顶层 `~~~` 定义函数、体内用 `> ~ f()` 调用）。
- `~~~` 到 body 末仍未闭合。

## 5. pass 3 · 行内趟

遍历 `RawBlock`，把每个原始字符串叶子按 AST 规范 §4（转义还原）、§5（实参切分、变体 `id`）精解析成最终 AST。

- **文本原串** → `InlineSegment[]`：字面段 + `{…}` 插值（花括号配平、`\{`/`\}` 不计、分配稳定 `id`）；识别行末 `<>` 置 `glue`；识别未转义的行末 `-> 目标(args)` 拆成相邻 `Divert`；字面段还原转义。一行文本因此产出 `TextLine`（+ 可选 `Divert`）。
- **选项原串** → 依次剥前导 `{cond}`（配平）作 `condition`、`(label)` 作 `label`；按未转义 `[` `]` 切出 `before` / `inner` / `after`；识别 glue 与行末 `->` 作 `resultDivert`；判定 fallback（无文本、无 `condition`、无 `label`、仅 `->`）。各文本区 → `InlineSegment[]`。
- **`@if` 分支原串** → 取出 `{cond}` 作 `condition`（`@else` 为 `null`）。
- **命令 / 跳转实参** → JS 感知切分（跳过字符串字面量与嵌套 `()[]{}`）成 `args[]`；命令 `name`、跳转 `target` 一并定下。
- **逻辑 `~` / `~~~`** → `code` 原样，无需再解析。

### 5.1 错误

- `{` 插值未闭合（无配平 `}`）。
- 选项 `[ ]` 不配平。
- `(label)` 未闭合。
- 实参表字符串 / 括号未闭合。
- 一组选项内多于一个 fallback（`ChoiceGroup` 收尾校验，spec §5.4）。

### 5.2 模块与增量

pass 3 产出最终 AST（`docs/reference/engine-ast-spec.md`），按三个独立可测的增量推进：

| 模块 | 职责 | 增量 |
|---|---|---|
| `ast.ts` | 最终 AST 类型（`ProjectFile`/`Knot`/`Stitch`/`ContentBlock`/`ContentElement`/`InlineSegment`…），全量落地，作增量②③的靶子 | ① |
| `interp.ts` | `findInterpEnd(s, start): number`——配平 `}` 之后的下标，不配平返回 `-1`（字符串字面量感知、`\{`/`\}` 不计）。`comments.ts` 改用它（pass 0 宽松：`-1` 当作吃到行尾）；pass 3 严格：`-1` 抛 `ParseError` | ① |
| `inline.ts` `scanInline` | `scanInline(text, startId, line, path): { segments, glue, nextId }`——文本片段 → `InlineSegment[]`（字面段还原转义 §4 + `{…}` 插值经 `findInterpEnd` 定界、分配 `id`）+ 行末 `<>` 置 `glue`。不处理行末 `->` 拆分与选项 `[]()` | ① |
| `inline.ts` `splitInlineDivert` | `splitInlineDivert(text): { text, divert }`——honoring `\` 与 `{}` 插值，找第一个未转义 `->`，切成左半文本与 `'-> …'\|null` | ② |
| `args.ts` | `splitArgs(inner, line, path): string[]`（顶层逗号切分，跳过字符串与嵌套 `()[]{}`）；`parseDivert(raw, line, path): {target, args}`；`parseCommand(raw, line, path): {name, args}` | ② |
| `choice.ts` | `parseChoice(raw, line, path): {condition, label, before, inner, after, divert, fallback}`——循环剥前导 `{cond}`/`(label)`（任意顺序、各至多一次）；未转义非插值内的 `[ ]` 切三段；末段 `splitInlineDivert` 出 `divert`；fallback = 无 cond/label/文本、仅 `->`。文本区为**原始串**，divert 为 `'-> …'\|null` | ② |
| `transform.ts` / `parse.ts` | 遍历 `RawFile` → `ProjectFile`（对文本区跑 `scanInline`、对 divert 跑 `parseDivert`、命令跑 `parseCommand`，线程化 id）；`parse(text, path): ProjectFile` 串起 pass 0–3 | ③ |

**变体 `id` 线程化**：`scanInline` 用调用方传入的 `startId` 起算、回传 `nextId`；增量③的 transform 顺整个文件单调线程化，保证每个 `interp` 节点 `id` 全局稳定唯一（供 §9 变体计数，AST 规范 §5）。

**选项不承载 glue（v1）**：AST `Choice` 无 glue 字段；增量③ transform 对选项文本区跑 `scanInline` 时忽略其 `glue`。文本行（`TextLine`）照常承载 glue。

**transform 细节（增量③）**：
- `RawText` → `splitInlineDivert` 切出尾随跳转：左半 `scanInline` 成 `TextLine`（含 glue），右半若有则 `parseDivert` 成相邻 `Divert`。
- `RawConditional` 的分支条件：`@else` 的 `condition` 为 `null`；`@if`/`@elif` 从 `RawBranch.raw` 的 `{cond}` 用 `findInterpEnd` 取出（缺 `{}` 或 `}` 后有非空白残留 → `ParseError`）。
- **选项组 ≤1 fallback**：transform 构建 `ChoiceGroup` 时校验，超过一个 fallback → `ParseError`（spec §5.4）。

**公共 API（`index.ts`）**：pass 3 落地后，`index.ts` 只导出 `parse(text, path): ProjectFile`、`ParseError`、全部 AST 类型；各 pass 内部函数不再从桶导出（跨 pass 集成测试改为从各模块直接 import）。

## 6. 测试策略

每趟独立单测；AST 是纯数据，直接深相等断言，不需 runtime。

- **pass 0**：text→text。`//`、跨行 `/* */`（含吃掉中间 `===` 行）、声明行尾注释剥离、`\/` 不剥、行号保真；JS 区域保留——`{}` 插值内、`~` 行、`~~~` 块、命令行 `@bg("http://x")`、行末内联 `-> 商店("http://x")`；未闭合 `/*` 报错（行号为起始行）。
- **pass 1**：text→骨架。多节点、带参节点、子节点、preamble、`\=` 字面行、各声明语法错误。
- **pass 2**：body→RawBlock。spec §6.2 餐厅嵌套、选项成组、`@if` 链、层级回落汇合、层级跳跃错误、`@else` 规则、`~~~` 未闭合。
- **pass 3**：RawBlock→AST，外加行内单测——段扫描、转义还原、`{}` 配平、glue、行末 `->` 拆分、选项 `[]()` 三段、label、condition、fallback、实参切分。
- **端到端**：完整 `.kin`→`ProjectFile`，以 spec §14 雾港之夜作黄金集成 fixture，断言整棵 AST。
- **错误**：每条 `ParseError` 一个 fixture，断言错误类型与行号。

## 7. 边界

- 不解析嵌入 JS（`code`/`condition`/`args` 元素为不透明字符串）。
- 不做任何语义检查（见 §0）。
- 不处理跨文件（单文件 text → 单 `ProjectFile`）；项目扫描与合并属 `project/`、analyze。
