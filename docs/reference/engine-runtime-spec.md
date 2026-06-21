# runtime 规范

> 子项目：`engine/`　|　依据：`docs/reference/kin_spec_draft.md` v0.1.0、`docs/reference/engine-m1-design.md` §2
> 上游：`docs/reference/engine-analyze-spec.md`（产出 `ValidatedProgram`）　|　下游：CLI player / reader

## 1. 范围

runtime 是 M1 流水线里**唯一有状态**的部分：吃 `analyze` 产出的 `ValidatedProgram`，建一个可被前端四动作驱动的 `Story` 对象，把故事执行成事件流。

```
ValidatedProgram ──▶ createStory(program, options) ──▶ Story（有状态）
                                                          │ 事件流: text / command
                                                          ▼ 输入: choose(index)
```

**做**：故事状态机（跳转、选项、`>` 汇合、粘连、`@if`、变体、作用域、回合数、可复现随机、带参节点）、Story 四动作接口、覆盖 spec 执行语义的测试。

**不做**：
- 文件系统扫描、读 `kiny.json`、选入口——`project/` 与 CLI 的职责。`createStory` 吃内存中的 `ValidatedProgram` + 显式入口。
- 命令的真实副作用（`@bg_show` 实际加载资源）——只发 `command` 事件，落地由 reader 接管。
- 语义/语法检查——parser 与 analyze 已在上游完成；`createStory` 只接受零-error 的 `ValidatedProgram`，信任其有效性。
- JS 沙箱化——宿主直接 `new Function` 执行。

## 2. 架构与模块划分（`engine/src/runtime/`）

控制流、数据、活文本状态三者分离，各自独立可测；`story.ts` 只做编排与四动作主循环。所有运行期状态摊在显式结构里（帧栈、各计数器、env 对象、回合记录），契合"可复现、可检视、将来可存档"。

| 文件 | 职责 | 依赖 |
|---|---|---|
| `story.ts` | `Story` 类：四动作接口 + 主循环（推进游标、产出事件、暂停于选项） | 以下全部 |
| `frames.ts` | 帧栈：`{block, index}` 帧的压/弹、游标推进、进选项体/`@if` 分支/汇合的控制流 | — |
| `env.ts` | 作用域对象 + `with` 链编译（`compileFragment`：片段 + 导出语句 → `new Function`）、内置函数注入 | `variants`、`rng` |
| `variants.ts` | `seq`/`cycle`/`once`/`shuffle` 实现 + 按 site-id 的计数器；acorn 给变体调用点打 site-id | `rng` |
| `rng.ts` | 可复现随机（`seed_random` 控制的确定性 PRNG），供 `random` / `shuffle` | — |
| `types.ts` | `OutputEvent` 等公共类型定义（含 `command` 事件变体）；M1 命令仅作事件，无副作用回调 | — |
| `index.ts` | `createStory` 总入口 + 公共类型导出 | 以上 |

## 3. Story 接口与输出事件

### 3.1 四动作接口

```ts
story.canContinue            // 还能产出文本/命令吗（到选项或结束前）
story.continue(): OutputEvent  // 推进，返回恰好一个事件
story.currentChoices         // 当前要展示的选项（已按条件过滤 + fallback 逻辑）
story.choose(index: number)  // 选择，推进进对应分支
story.hasEnded               // -> END 后为 true
```

主循环（CLI / reader 同一套）：`while (canContinue) continue() → 处理事件`；停下后若有 `currentChoices` 就让用户选、`choose()`；否则 `hasEnded`。

`createStory(program, options)`：`options.start` 给定入口 knot 名（CLI 从 `kiny.json` 的 `entry` 文件取首 knot，或显式指定）。

### 3.2 输出事件

```ts
type OutputEvent =
  | { kind: 'text'; text: string }                      // 一整行叙事，插值/变体/粘连均已解析
  | { kind: 'command'; name: string; args: unknown[] }  // 内置命令，实参已求值，交给 host
```

选项不是事件，而是 `currentChoices` 状态。`Choice`（展示用）至少含 `{ text: string }`（列表文字，见 §7）。

### 3.3 粘连合并与命令边界

runtime 维护一个**待输出文本缓冲**。推进游标时：

| 元素 | 行为 |
|---|---|
| 文本 | 解析后追加进缓冲。带 glue（抑制其后换行）→ 不 flush、继续推进；否则这行完整 → 返回 `text` 事件、清空缓冲 |
| 跳转 `->` | 移动游标，glue **跨越**继续合并（§10：粘连跨 `->`，接上目标第一段文本） |
| 逻辑行 `~` / `~~~` | 跑副作用，无输出，继续 |
| 命令 `@cmd` | 硬输出边界：缓冲非空则**先 flush 文本**（命令留到下次 `continue`），缓冲空则直接返回 `command`。**粘连不跨命令** |
| 选项组 | 先 flush 待输出文本，再转为 `currentChoices`，`canContinue` 转 false |
| `@if` 链 | 求值条件进命中分支（压栈），继续 |
| 触底 / `-> END` | flush 缓冲后 `hasEnded = true` |

`canContinue` = "再调一次 `continue()` 还能产出事件"（缓冲有待 flush 文本，或游标后面还有可执行元素，且未停在选项/结束）。

## 4. 执行状态与控制流

**帧** = 正在执行的某个 `ContentBlock` 里的位置：`{ block, index }`。**帧栈**表达嵌套：栈底是当前 knot/stitch 正文，往上是进入的选项体、`@if` 分支体（可再嵌套）。游标 = 栈顶帧的 `block[index]`。

### 4.1 单步推进规则

| 当前元素 | 动作 |
|---|---|
| 文本 / 命令 / 逻辑行 | 按 §3.3 处理；`index++` |
| 跳转 `->` | 解析目标，**整个帧栈重置为 `[{目标 block, 0}]`**（跳转不返回、放弃当前所有帧）。粘连缓冲不清、跨过去 |
| 选项组 | 求值各选项（§7），有可见选项则设 `currentChoices`、**暂停**；无可见选项按 §7.2 自动走 fallback 或跳过、**不暂停**。当前帧 `index++` 越过选项组（为 `choose` 后汇合留位） |
| `@if` 链 | 按序求值条件取首个命中分支（或 `@else`），**压一帧** = 该分支体；父帧 `index++` 越过 conditional。无命中且无 else → 仅越过 |
| 帧 `index` 到块尾 | **弹栈**。栈空 → 当前 knot 正文触底无跳转 → flush 后 `hasEnded`；还有父帧 → 父帧从已越过子元素处继续 = **自动汇合（gather）** |

`choose(index)`：给选中选项**压一帧** = 该选项体（index 0）；标记一次性已选 / 标签计数 +1 / 回合 +1（§6、§7）；恢复推进。选项体耗尽弹栈 → 回到父帧越过选项组之处 = 汇合到选项组之后。

### 4.2 汇合免费

帧栈天然表达 `>` 层级汇合：选项体 / `@if` 分支体是子帧，子帧耗尽即弹栈回父帧续接 = "层级减少自动汇合到外层"（§6）。嵌套选项 / `@if` 互嵌 = 帧再叠帧。`> -> 目标`（体内显式跳走）走"跳转重置帧栈"那条 → 不参与汇合（§6.4）。**关键洞察**：跳转是唯一会清空帧栈另起一根的操作；选项 / `@if` 只压/弹子帧。gather 无需任何 `>` 计数——嵌套已由 AST 树形 + 帧栈承载。

## 5. 变量环境

### 5.1 三层作用域 + `with` 链

每个作用域是一个普通对象，编译进一条三层 `with` 链——内置 `B`、全局 `G`、节点局部 `L`，内层优先。读/写沿 `L → G → B` 解析：节点局部遮蔽全局，赋值落到变量实际所在那层（analyze 已保证变量必声明、绝不泄漏到 `globalThis`）。`B` 放 8 个内置函数（§6）。

### 5.2 声明持久化（导出语句，无 codegen）

JS 的 `let`/`const` 是块作用域、函数返回即消失。做法：**片段代码原样不动，在同一块末尾追加导出语句**，把该片段顶层声明的值拷进作用域对象（如 `L.dice = dice`），使其对后续片段可见——无需 codegen。

- 导出名单 = analyze 已收集的该片段**顶层** `let`/`const`/`function` 声明名；目标对象 = 片段作用域（preamble 片段 → `G`，节点片段 → `L`），块内临时声明不导出。
- 表达式片段（`{}` / 条件 / 实参）按"求值返回"编译；每个片段编译一次、缓存复用。

### 5.3 作用域生命周期

- **全局 `G`**：启动时按文件名字典序（§7.6）跑完各 preamble 片段建好，整局存活。标签亦初始化于 `G`（§7）。**例外**：起点正是某文件的开场 knot（`openingKnotName(path) === start`）时，`buildGlobals` **跳过该文件的 preamble**——它会在进入开场 knot 时按源码顺序执行，跳过可防重复执行（其余文件 preamble 照常预跑建全局）。
- **节点局部 `L`**：进入 knot 时**新建**；跳转到**别的 knot** 丢弃旧 `L`、建新的；跳转到**本 knot 的子节点**保留 `L`（参数仍可见，§2.2）。`L` 按 **knot** 绑定，不按 stitch。
- **开场 knot（`scope:'global'`）**：进入时 `L = G`（不新建局部层）。开场内 `~ let/const` 经导出落 `G`、插值/逻辑读 `G`，故声明对后续任意节点可见；这正是 spec §1.3「开场作用域为全局」的落点。
- **带参进入** `-> 商店("灯笼", 0.8)`：实参在**当前（旧）env** 求值，再新建 `L` 绑定 `L.category="灯笼"`、`L.discount=0.8`，然后进目标。

## 6. 变体 / `turns` / 可复现随机

### 6.1 可复现随机（`rng.ts`）

内置确定性 PRNG（mulberry32 一类），**默认固定种子**（不调 `seed_random` 也可复现，方便黄金测试）。`seed_random(n)` 重置种子。`random(min, max)` 返回 `[min, max]` 闭区间整数。`shuffle` 复用同一 PRNG。

### 6.2 `turns` / `turns_since`

- 一个"回合"= 一次玩家决策。`turns()` 返回至今 `choose()` 次数（起始 0，每次 `choose()` +1）。
- 进入某 knot 时记 `visitedAt[knot] = 当前回合数`。`turns_since("名")` = 已访问则 `turns() - visitedAt[名]`，未访问返回 `-1`（§12.1）。

### 6.3 变体计数（site-id，`variants.ts`）

§9 要求变体"按**源码位置**"各记一个计数器；§9.5 的 `cycle("小狗", shuffle("黑狗","花狗"))` 在同一 `{}` 里有两个变体调用，故不能按 `{}` id 记。

- 编译含变体的片段时，给每个 `seq`/`cycle`/`once`/`shuffle` 调用按其源码位置分配一个**稳定 site-id**（编译期自动注入、作者不可见），runtime 据此为每个 site 维护独立计数器。
- 各变体语义：`seq` 依次推进、停在最后一项（§9.1）；`cycle` 循环（§9.2）；`once` 依次返回、用完返回空串（§9.3）；`shuffle` 每次随机返回一项、受 `rng` 控制（§9.4）。
- 计数器随 story 存活；同一 site 每次经过推进自身计数（§9.5 嵌套作为实参的变体被立即求值——由 JS 求值顺序天然实现）。

## 7. 选项状态

### 7.1 计算 `currentChoices`

游标到达选项组时：

1. 对每个选项求值 `condition`（如有，在当前 env），假则排除；
2. **一次性 `*`** 已选过的排除，**粘性 `+`** 保留；
3. **fallback**（`* -> 目标`，无文本无条件）永不进显示列表；
4. 列表文字 = `before + inner`（`[]` 内只进列表），求值插值/变体后展示。

### 7.2 fallback 触发（§5.4）

- 可见选项**非空** → 设 `currentChoices`、暂停等玩家选；
- **为空但有 fallback** → **自动执行 fallback**（不暂停、不显示，直接走其跳转）；
- **为空且无 fallback** → 跳过该组、汇合到组后内容。

每组至多一个 fallback（analyze 已保证）。

### 7.3 `choose(index)`

i 索引进 `currentChoices`。取选中 `Choice` 后：

1. 标记该选项已选（一次性用）；
2. 有标签 → `G.<label>++`；
3. **回合数 +1**（喂 `turns`）；
4. 产出**点击正文** = `before + after`（`]` 后只进正文），走文本缓冲 / 粘连（§3.3）；
5. 然后：有 `resultDivert` → 跳转（重置帧栈）；否则选项体非空 → 压帧执行（耗尽即汇合）；否则直接汇合。

### 7.4 状态键与标签值

- 一次性"已选"与标签计数都按**选项的 AST 节点身份**（= 源码位置，静态稳定）记——循环回到同一选项组时 AST 节点同一、状态正确累积、不会因重访重置。
- 每个标签启动时于 `G` 初始化为 0；读 `{greet}` 经 with 链解析到 `G.greet`。analyze 已保证标签不与全局变量重名。
- 选项列表文字（`before+inner`）在**呈现时**求值、点击正文（`before+after`）在**选择时**求值；`before` 两处都出现，若内含变体会推进两次——罕见，按此约定。

## 8. 错误处理

- **JS 运行期抛错**：片段 `new Function` 执行可能抛（类型错误、调用未定义函数等——analyze 只静态查未声明变量）。runtime 捕获并包装成 `RuntimeError{ message, file, line }` 抛出 `continue()` / `choose()`，CLI 据此报告；故事不在 JS 错后续跑。
- **可信的已校验程序**：`createStory` 只接零-error 的 `ValidatedProgram`；跳转目标、实参个数等 analyze 已保证，runtime 信任之。万一运行期缺目标（不应发生）→ 防御性抛 `RuntimeError`。
- **死循环防护**：每次 `continue()` 设**步数预算**，超限抛"疑似死循环"，避免空转挂死。
- **误用**：`choose(i)` 越界、`!canContinue` 时调 `continue()` → 抛错。

## 9. 测试策略

黄金 trace 为主（沿用 m1-design §5）。

- 一个 fixture = **小 `.kin`（或小项目）+ 选择脚本（`choose` 序号序列）+ 期望确定性 trace**（文本行 / 展示过的选项列表 / 命令事件）。
- **驱动 harness**：把 Story 按脚本跑完，序列化成确定性文本 trace，存盘比对。固定默认种子让 `shuffle` / `random` 进黄金。
- **spec 执行示例直接抄成 fixture**：§2.1 触底、§6 分支汇合、§8 `@if`、§9 变体推进、§10 粘连缝句、§14 完整雾港之夜——spec 自带验收用例。
- **模块单测**：`frames` / `env` / `variants` / `rng` 各自隔离测（帧进出与汇合、with 链遮蔽与持久化、site-id 计数、PRNG 确定性）。
- **判据**：能在内存里把 §14 雾港之夜按一段选择脚本跑出与 spec 示例一致的 trace。

## 10. 依赖

- 复用既有 `acorn`（变体调用点 site-id 重写）；无新增第三方依赖。
- runtime 不碰文件系统、不读 `kiny.json`——输入即 `ValidatedProgram` + 入口名。

## 11. 构建顺序

自底向上，每层在前一层稳定后叠加：

```
线性文本 + 跳转 + END        （frames 雏形 + story 主循环 + text 事件）
作用域 + JS 求值 + {} 插值   （env：with 链 + 导出持久化）
选项                          （currentChoices / choose / 一次性 / 粘性 / 条件 / fallback / 标签计数）
分支体 + > 层级汇合           （帧栈压/弹 = gather）
粘连 <>                       （文本缓冲跨 -> 合并）
变体 seq/cycle/once/shuffle   （variants：acorn site-id + 计数器）
@if 条件块                    （conditional 分支压帧）
带参节点 + turns/turns_since + 可复现随机（rng + 回合/访问记录 + 带参 L 绑定）
```

## 12. 留待讨论的点

- **`story.ts` 拆分评估（远期）**：`story.ts` 当前约 430 行、职责单一（编排 + 主循环），尚在单文件可维护区间。若后续再加事件类型/分发逻辑，届时评估把 `step` 分发或 `buffer/bufferGlued` 状态机抽成独立单元。
