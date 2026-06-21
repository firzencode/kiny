# CLI 终端播放器规范

> 子项目：`engine/`　|　依据：`docs/reference/kin_spec_draft.md` §1、`docs/reference/engine-m1-design.md` §2.1 / §2.2
> 上游：`docs/reference/engine-analyze-spec.md`（`analyze` / `resolveStart`）、`docs/reference/engine-runtime-spec.md`（`createStory` / `Story`）

## 1. 范围

CLI 是 M1 流水线最外层的**薄层**：把一个标准 Kiny 项目目录加载、编译、校验后在终端里跑起来——打印文本与命令、读键盘选择，直到故事结束或用户退出。

```
项目目录 ──▶ project（读盘+组装） ──▶ analyze ──▶ resolveStart ──▶ createStory ──▶ play 循环 ⇄ 终端
```

**做**：项目加载（`project/`，纯逻辑 + IO 壳分离）、命令行编排（`cli/run.ts`）、播放循环（`cli/player.ts`）、终端 IO 缝（`cli/term.ts`）。

**不做**：
- `check` 等开发者子命令——只做播放器。
- 命令落地——`@bg_show` 等只打印标注、不加载资源（M1 边界，spec §11）。
- 构建/打包——`tsx` 直跑源码。
- 图形界面——那是 reader。

## 2. 加载对象与校验

播放器加载的是一个**标准 Kiny 项目目录**（spec §1）：根部含 `kiny.json`，递归扫描其下所有 `.kin`。单个文件不算项目。

`kiny.json` 四字段全必需（spec §1.1）。校验在两处分工：

- **存在性 / 格式**：缺 `kiny.json`、非合法 JSON、缺字段或字段非非空字符串 → 加载失败。
- **引用完整性**：`entry` 必须指向扫描到的某个 `.kin`，否则失败。
- `engine` 字段只读取、不做版本兼容比较（见 `engine-m1-design.md` §1 不做项）。

校验**一次报全**（收集所有 manifest 错、所有文件的 parse 错），不在第一个错处中断。

## 3. 架构与数据流

`project/`（读盘 → `ProjectFile[]`）与 `cli/`（编排 + 渲染）**严格分层**，且 `project/` **不跑 analyze**——analyze 与运行编排都归 `cli/run.ts`。这样 `project/` 是个干净的项目加载器，将来供 reader / editor 复用。

```
engine/src/
├── project/                # 项目加载器（可被 reader/editor 复用）
│   ├── manifest.ts         # 纯：校验 kiny.json 四字段
│   ├── assemble.ts         # 纯：逐文件 parse + 字典序排序 + 校验 entry 存在
│   ├── load.ts             # IO 壳：扫目录、读文件 → 喂纯核心
│   └── index.ts            # 出口 loadProject + 类型
└── cli/
    ├── run.ts              # 编排：loadProject → analyze → resolveStart → createStory → play
    ├── player.ts           # 播放循环（吃 Story + Term，可脚本化测试）
    ├── term.ts             # Term 接口 + 真终端实现（readline + ANSI）
    └── index.ts            # 真壳（不测）：makeTerminal → run → process.exit
```

数据流与各阶段失败出口：

```
项目目录
  │ loadProject              失败 → 打印 errors，退出码 1
  ▼
ProjectFile[]
  │ analyze                  有 error → 打印诊断，退出码 1
  ▼
ValidatedProgram (+ warnings 照印不阻断)
  │ resolveStart(program, entry)   无入口 → 退出码 1
  ▼
createStory(program, { start, seed })
  │ play(story, term)        运行期 RuntimeError → 打印 file:line，退出码 1
  ▼
正常跑完 / 用户 q          退出码 0
```

**关键分层原则**：所有终端格式化都在 `player.ts` / `run.ts`，`term.ts` 只负责"写一行 / 读一行"这两个 IO 动作。因此测试注入一个假 `Term` 即可对精确输出字符串做断言，真终端壳无需测试。颜色（ANSI dim）仅当输出连到真实 TTY 时启用，非 TTY（管道/重定向/测试）走纯文本。

## 4. 对外契约

`project/` 对外暴露 `loadProject(rootDir)`，返回一个判别联合：成功给出 `files / entry / meta`，失败给出收集到的 `errors`（每条带 `kind: manifest|parse|io` 与可选 `file:line`）。

`cli/` 暴露 `run(argv, term): Promise<number>`（返回退出码）与 `play(story, term)`（返回 `'ended' | 'quit'`）。`Term` 是 IO 缝接口：写一行、读一行、是否启用颜色。

> 具体字段、函数签名与实现见源码（`engine/src/project/types.ts`、`cli/term.ts` 等）——本规范只锁定职责与流程，不复制类型定义。

## 5. 命令行与播放行为

- **参数**：第一个非 `--` 项为项目目录（缺省 `.`）；`--seed <n>` 指定可复现随机种子（引擎已支持，见 runtime §6.1）。
- **播放循环**（`player.ts`）：`canContinue` 就 `continue()` 打印——文本直接输出，命令打成淡色标注行 `» 名(实参, …)`；不能继续时，若 `hasEnded` 打印结束标记，否则呈现编号选项、读输入。
- **选择输入**：整数 `1..N` 选对应项；`q` / `quit` 优雅退出；非法输入重新提示、不退出。
- **命令标注格式** `» bg_show(harbor_fog.jpg)`：实参求值后 `String` 化、逗号分隔——与 spec §14 trace 风格一致。

## 6. 错误与退出码

| 情形 | 行为 | 退出码 |
|---|---|---|
| 缺/坏 `kiny.json`、缺字段、`entry` 不存在、文件 parse 错 | 打印 `error [file:line] message` | 1 |
| analyze 有 error | 打印诊断 | 1 |
| 无可运行入口（`resolveStart` 返回空） | 打印提示 | 1 |
| 运行期 `RuntimeError` | 打印 `运行期错误 file:line message` | 1 |
| analyze warning（如触底告警） | 打印但不阻断 | 不影响 |
| 非法选择输入 | 重新提示 | 不退出 |
| 正常跑完 / 用户 `q` | — | 0 |

诊断打印格式统一为 `<severity> <file>:<line> <message>`。

## 7. 测试策略

- **`project/` 纯核心**：`manifest`（各字段缺失/类型错/全合法）、`assemble`（多文件字典序、entry 缺失报错、ParseError 透传带 file:line）单测；`load` 用小 fixtures 目录触盘验证 io / manifest 错。
- **`cli/player`**：渲染金标准——假 `Term` + 内存 program + 脚本化选择，断言输出序列（文本行、`»` 命令行、编号选项、结束标记、非法输入重提示、`q` 退出）。
- **`cli/run`**：各失败出口的打印与退出码、warning 照印不阻断、正常项目跑通。
- **e2e**：`samples/雾港之夜`（spec §14 雾港之夜落成的真实项目）作为 M1 完成判据——`run` 跑通、trace 含 §14 文本与命令行、最终 `ended`。

## 8. 留待讨论的点

- 除 `--seed` 外是否需要其它运行期开关（如 `--quiet` 关命令标注）——暂不做（YAGNI）。
- `engine` 版本兼容校验——待引擎版本有实际意义后再设计（见 `engine-m1-design.md` §1）。
