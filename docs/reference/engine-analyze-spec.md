# analyze 规范

> 子项目：`engine/`　|　依据：`docs/reference/kin_spec_draft.md` v0.1.0、`docs/reference/engine-m1-design.md` §3
> 上游：`docs/reference/engine-parser-spec.md`（产出 `ProjectFile`）　|　下游：runtime（消费 `ValidatedProgram`）

## 1. 范围

analyze 是编译器前端的**语义检查**阶段，一个**纯函数**：吃一组已 parse 的文件，合并全局命名空间，跑全部静态检查，产出"已校验程序"或诊断集。

```
ProjectFile[]  ──▶  analyze()  ──▶  AnalyzeResult
（多文件 AST）       纯函数            { program | null, diagnostics }
```

**做**：跨文件符号表构建、全部静态检查（10 类 error + 1 类 warning，见 §5）、JS 片段的声明/引用分析、错误与警告分级收集。

**不做**：
- 文件系统扫描、读 `kiny.json`、文件排序——这些 IO 是 `project/` 模块的职责。analyze 只吃内存中的 `ProjectFile[]`。
- 执行任何 JS、运行故事——那是 runtime。
- 语法错误检查——parser 已在上游对每个文件 fail-fast 拦掉；analyze 只在所有文件成功 parse 后介入。
- `turns_since("节点名")` 实参指向的节点是否存在——要从 JS 字面量回抽节点名，价值低、易误伤，M1 不校验。

## 2. 错误模型

**收集式**，不 fail-fast：一次跑完所有检查，列出全部问题，作者一遍就能看到所有错误而非改一个跑一次。

诊断分两级：

- **error**：违反 spec 强制规则。存在任一 error → `program = null`。
- **warning**：spec 标注为警告的情形（§2 / §2.1 触底无跳转）。不阻断 `program` 产出。

parser 的 fail-fast 与 analyze 的收集式不冲突：二者在流水线的不同阶段，parser 在每个文件 parse 时拦语法错误，analyze 只处理跨文件语义，所有文件都成功 parse 后才运行。

## 3. 模块划分（`engine/src/analyze/`）

| 文件 | 职责 |
|---|---|
| `index.ts` | 公共入口 `analyze(files)`：建符号表 → 跑各检查 → 汇总 diagnostics → 产出 program |
| `types.ts` | `AnalyzeResult` / `ValidatedProgram` / `Diagnostic` 类型 |
| `symbols.ts` | 构建全局符号表（节点表、子节点表、全局声明、标签集 + 带 `{file,line}` 的出现记录），纯建表不产诊断 |
| `js-scope.ts` | acorn 封装：单个 JS 片段 → `{ declares, references }` |
| `checks/names.ts` | 节点/子节点重名 |
| `checks/identifiers.ts` | 保留字占用、非 ASCII 标识符（变量名 / 标签） |
| `checks/diverts.ts` | 跳转目标存在性、带参实参个数、非法进入带参节点子节点 |
| `checks/variables.ts` | 未声明变量、跨文件全局重复声明 |
| `checks/labels.ts` | 标签全局唯一、标签 vs 变量重名 |
| `checks/commands.ts` | 未知 `@命令` |
| `checks/fallthrough.ts` | 节点/子节点/开场正文触底无出口 → warning |
| `opening.ts` | 合成开场 knot（`openingKnotName` / `addOpeningKnots`）+ 入口解析（`resolveStart`） |

每个 `checks/*.ts` 都是只读符号表的纯函数，返回 `Diagnostic[]`，彼此无顺序依赖，可独立测试与任意拼接。`index.ts` 只负责编排与拼接。

## 4. 核心契约（`types.ts`）

```ts
interface Diagnostic {
  severity: 'error' | 'warning'
  code: string          // 'duplicate-knot' | 'undeclared-var' | ...（见 §5）
  message: string       // 中文为主
  file: string
  line: number
}

interface ValidatedProgram {
  files: ProjectFile[]                       // 原始 AST，按文件名字典序合并
  knots: Map<string, Knot>                   // 全局节点表
  stitches: Map<string, Map<string, Stitch>> // 父节点名 → (子节点名 → Stitch)
  globals: Set<string>                       // 全局 let/const/function 声明名
  locals: Map<string, Set<string>>           // 节点名 → 该节点局部声明名（含参数）
  labels: Set<string>                        // 选项标签（全局自动计数器）
}

interface AnalyzeResult {
  program: ValidatedProgram | null  // 有 error 则为 null；仅 warning 仍产出
  diagnostics: Diagnostic[]
}
```

`ValidatedProgram` 把符号表与作用域表一并传给下游 runtime，runtime 解析跳转目标、绑定参数、区分全局/局部变量直接查这些表，不重算。

## 5. 检查清单

### 结构类（纯 AST）

1. **节点全局重名** `duplicate-knot` (error)：跨所有文件 `Knot.name` 唯一。
2. **子节点同父内重名** `duplicate-stitch` (error)：同一 `Knot` 内 `Stitch.name` 唯一；不同父节点可重名。
3. **跳转目标存在** `unknown-divert-target` (error)：解析 `Divert.target`——
   - `END` / `DONE` 合法终点，放行；
   - 含 `.` → `父.子` 路径，查 `stitches`；
   - 无 `.` → 先查全局 `knots`，再查**当前宿主节点的同级子节点**（spec §2.1：同父内 `-> 子节点名` 合法）。检查时携带 divert 所在的宿主 `Knot` 上下文。
   - **消歧约定**：无 `.` 的目标同时命中全局 `knots` 与当前节点同级子节点时，全局 knot 优先。spec 未规定此优先级，这是 analyze 自定的消歧规则（作者应避免此类同名）。
4. **带参实参个数匹配** `divert-arity` (error)：目标是带参 `Knot` 时 `Divert.args.length` 必须等于 `Knot.params.length`；目标是无参节点时要求 `args.length === 0`。
5. **非法进入带参节点子节点** `param-knot-stitch-entry` (error)：spec §2.2——带参节点只能经 `-> 名(args)` 整体进入，禁止从外部 `-> 带参节点.子节点` 跳进它的子节点（参数无从绑定）。同节点内部 `-> 子节点` 不受限（参数仍可见）。
6. **未知命令** `unknown-command` (error)：`Command.name` 必须属于内置集 `{bg_show, bg_hide, bgm_play, bgm_pause, bgm_stop}`。

### 符号 / JS 类（用 acorn）

7. **保留字占用** `reserved-identifier` (error)：8 个内置函数名（`random`/`seed_random`/`turns`/`turns_since`/`seq`/`cycle`/`once`/`shuffle`）不可作变量名、函数声明名、参数名或选项标签。
8. **标签唯一 + 不撞变量** `duplicate-label` / `label-var-collision` (error)：选项标签全局唯一，且不与任何 `let`/`const` 重名。
9. **未声明变量** `undeclared-var` (error)：对每个 JS 引用，按作用域链判定悬空。**允许名单** = 全局声明 ∪ 当前节点局部声明（含参数）∪ 8 内置函数 ∪ 选项标签 ∪ JS 内建全局白名单（§6）。同名变量跨文件重复声明 `duplicate-global` (error) 在此步顺带查。
10. **非 ASCII 标识符** `non-ascii-identifier` (error)：变量名（`js-scope` 提取的 `let`/`const`/`function` 声明名）与选项标签必须是 ASCII 标识符（`/^[A-Za-z_][A-Za-z0-9_]*$/`，spec §7 / §5.5）。参数名 parser 已校验，此处补查 JS 声明名与标签——acorn 接受 Unicode 标识符（如 `~ let 金币`），故须显式拦截。

### 警告类

11. **触底无显式出口** `fallthrough` (warning)：检查节点正文、子节点正文与**开场**（`ProjectFile.preamble`）。正文为空，或其最后一个元素是被动元素（`text` / `command` / `logicLine` / `logicBlock`）时报 warning；以 `Divert`（含 `-> END`）、选项组或 `@if` 块结尾均视为合法终点，不报。**不检查选项体 / `@if` 分支体**——它们靠自身跳转或 gather 汇合到外层，不是独立出口，对其报"触底"是误报（spec §14 即以选项组 / gather 分支为常态）。开场触底**仅当该文件同时含显式 knot 时才报**（`preamble` 非空 + `knots.length > 0`）——零节点的纯文本文件触底 `END` 是正常终局，不报。不阻断 program。

## 6. JS 片段分析（`js-scope.ts`）

用 acorn 解析每个不透明 JS 片段，提取：

- **declares**：`let` / `const` / `function` 声明名、函数参数名。
- **references**：自由标识符引用（成员访问 `a.b` 只算 `a`；对象字面量的键不算引用；解构、箭头函数参数按声明处理）。

JS 片段来源：所有 `InlineSegment` 的 `interp.code`（含 `TextLine.segments` 与 `Choice` 的 `before`/`inner`/`after` 内的插值）、`LogicLine.code`、`LogicBlock.code`、`Divert.args[]`、`Command.args[]`、`Choice.condition`、`ConditionalBranch.condition`（`@if` / `@elif` 的条件表达式）。所有来源同样适用 acorn 语法检查（失败转 `js-syntax-error`）。

**作用域两级**（spec §7.2）：
- 全局作用域：节点之前（`ProjectFile.preamble`）的声明。
- 节点作用域：节点内（含其子节点、参数）的声明，离开节点失效。

**函数与变量一视同仁，按声明位置定作用域**：preamble 中的 `let` / `const` / `function` 才是全局、才全局唯一；写在节点体内的一律节点局部，仅本节点（含子节点）可见。spec §12「函数名与变量名全局唯一」中的「全局」即指此处的全局（preamble）作用域——可复用函数应声明在节点之前。

**JS 内建全局白名单**：保守维护一份常用名单（`Math` / `JSON` / `Object` 等，完整清单见 `engine/src/analyze/constants.ts`），按需扩充。保守名单能抓出 `Math.flooor` 这类拼错的全局；冷门全局（`Symbol`、`Reflect` 等）按需补入。

**acorn 解析失败**：JS 片段本身写错（如 `{ gold + }`）让 acorn 抛 parse error 时，捕获并转成 `js-syntax-error` (error) Diagnostic（带文件 + 行号），不让异常冒泡炸穿 analyze；该片段其余检查跳过，其他片段照常进行。

## 7. 执行顺序

`index.ts` 编排：

1. 建符号表（`symbols.ts`）——**纯建表，不产任何诊断**；为支持查重，符号表保留带 `{file, line}` 的出现记录（节点 / 子节点 / 全局声明 / 标签）。
2. 合成开场 knot（`opening.ts` 的 `addOpeningKnots`）：见 §10。
3. 跑依赖符号表的检查（diverts 查目标表、variables 查作用域表、labels 查变量表、identifiers 查保留字/ASCII、names/commands/fallthrough）。**所有诊断（含 `duplicate-knot` / `duplicate-stitch` / `duplicate-global` / `duplicate-label`）均由 `checks/` 产出**——symbols 只提供数据。
4. 汇总所有 diagnostics；有任一 error → `program = null`，否则产出 `ValidatedProgram`。

## 8. 测试策略

沿用项目既有 vitest + fixture 风格。

- **检查单测**：每个 `checks/*.ts` 配 `.test.ts`，构造最小违规 AST（直接构造 `ProjectFile` 或喂极小 `.kin` 过 parser），断言报出预期 `code` + `line`。
- **js-scope 单测**：喂 JS 片段字符串，断言 `declares` / `references`，覆盖成员访问 `a.b`（只算 `a`）、对象字面量键不算引用、解构、箭头函数参数等。
- **集成测试**：
  - 正例：§14 雾港之夜（parser 的 golden fixture）过 analyze 应**零 error**（触底 warning 可有）——贯通判据。
  - 反例：每类 error 构造违规小项目，断言精确报错。
- **多文件**：构造两文件项目，验证跨文件节点重名、全局变量重复声明、字典序合并。

## 9. 依赖

- 新增 `acorn`（轻量、零依赖、事实标准 JS parser）；更新 `engine/package.json`。
- analyze 不碰文件系统、不读 `kiny.json`——纯函数，输入即 `ProjectFile[]`。

## 10. 开场 knot 合成与入口解析（`opening.ts`）

入口文件首个节点前的整段内容（`ProjectFile.preamble`）在语义上是「开场」（spec §1.3）。analyze 把它显式化为一个作用域为全局的 knot，供 runtime 像普通 knot 一样进入、执行、跳转。

- **`openingKnotName(path) → string`**：开场 knot 的保留合成名，按文件路径唯一，且采用作者语法无法书写的形式，故绝不与作者声明的 knot 撞名。
- **`addOpeningKnots(knots, files)`**：为每个 `preamble` 非空的文件合成一个作用域为全局的 `Knot`（`body = file.preamble`），注册进全局 knots 表供 runtime 进入。合成是加法式的，不影响其它遍历各文件原始结构（`file.knots`）的检查。
- **`resolveStart(program, entryPath) → string | null`**：解析入口起点——入口文件有 `preamble` → 其开场 knot 名；否则第一个显式 knot 名；都没有 → `null`（无可运行入口）。供 CLI / reader 复用。
