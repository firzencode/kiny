# Engine 公共 API 与构建

> 子项目：`engine/`　|　性质：对外契约（最终态）

## 1. 形态

`@kiny/engine` 是一个**全纯库**：不含任何 `node:` 内建（无 fs / path / readline）、无 DOM。可在任何有 JS 运行时的环境运行——Tauri WebView、浏览器、Node。「收集文件」（扫盘 / fetch）天生平台相关，归各消费者，不在 engine 内。

## 2. 公共入口

单一入口 `@kiny/engine`（源码 `src/index.ts`）。导出面：

| 分类 | 导出 |
|---|---|
| parser | `parse`、`ParseError`；AST 类型（`ProjectFile` / `Knot` / `Stitch` / `ContentBlock` / `ContentElement` / `TextLine` / `Divert` / `ChoiceGroup` / `Choice` / `Conditional` / `ConditionalBranch` / `LogicLine` / `LogicBlock` / `Command` / `InlineSegment`） |
| analyze | `analyze`、`resolveStart`、`openingKnotName`；类型 `Diagnostic` / `AnalyzeResult` / `ValidatedProgram` |
| runtime | `createStory`、`Story`、`RuntimeError`；类型 `OutputEvent` / `ChoiceView` / `StoryOptions` |
| project | `validateManifest`、`assembleProject`、`loadProjectFromFiles`；类型 `KinyMeta` / `LoadResult` / `ProjectError` |

`loadProject`（`node:fs` 扫盘）**不在 engine**——它是 cli 的代码。

## 3. 加载流水线

消费者负责把文件收集进内存，再走纯流水线：

```
收集（平台相关）→ Map<path,text> + kiny.json 文本
   loadProjectFromFiles(manifestText, files) → LoadResult
   analyze(files) → { program, diagnostics }
   resolveStart(program, entry) → start
   createStory(program, { start, seed }) → Story
```

- reader（Tauri）：Tauri fs 插件 / 打包资源 / `fetch` 收集
- cli：`node:fs` 递归扫盘（`cli/load.ts` 的 `loadProject`）收集

`Story` 驱动接口见 `docs/reference/engine-runtime-spec.md`；命令出口为 `Story` 事件流里的 `command` 事件。

## 4. 构建

- `npm run build` → `tsc -p tsconfig.build.json`，emit `dist/`（ESM + `.d.ts` + `.d.ts.map`），排除 `cli/**` 与测试。
- package `exports` 仅 `.` → `dist/index.{js,d.ts}`。
- 产物面向 **bundler 消费者**（reader/editor 走 Vite/Tauri）：import 不带扩展名，不可 `node dist/...` 直跑。
- cli 开发期用 `npm run play`（tsx 直跑源码），不依赖 dist。
- `private: true`，不发 registry；reader/editor 经 `file:../engine` 或 bundler 别名指向 `engine/dist` 引用。

## 5. 不变量

- engine 包内（`src/`，除 `cli/` 与测试外）不出现 `node:` 内建。
- `loadProject` 只在 `cli/`；engine 公共面无它。
- cli 是「消费者样板」：业务符号只从 `@kiny/engine`（`../index`）取，fs 收集是 cli 自有代码。

## 留待讨论的点

- 磁盘项目约定（递归扫 `.kin`、跳过 `.` 目录与 `node_modules`、路径归一）目前只在 cli。editor 若需复用，因其用 Tauri fs，届时按实际形态抽平台无关 helper。
- 若将来要纯 Node ESM 直跑 dist，需切 `NodeNext` + 显式 `.js` 扩展名或加 bundling。
- 「engine 内无 `node:` 内建」目前靠 import 习惯 + 契约测试；可加「扫 `dist/index.js` 依赖图」的硬检查。
