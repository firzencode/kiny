# Kiny

**Kiny** 是一种受 [Ink](https://www.inklestudios.com/ink/) 启发的互动叙事 DSL，定位「Ink 的更简洁版本」：作者优先、中文友好、跨平台。故事文件用 `.kin` 扩展名。

目标产物是一整套生态：**引擎**（读 `.kin`、跑故事）、**阅读器**（玩家读故事）、**编辑器**（作者写故事）。

## 当前状态

**MVP 已完成** —— engine（parser + 静态检查 + runtime + 终端播放器）、player 播放层 + web-reader 浏览器阅读器、editor（Tauri 2 桌面端故事编辑器）、reader（Tauri 2 桌面端通用阅读器）均已交付。

## 快速上手

仓库是多子项目布局，依赖链 `engine ← player ← { web-reader, editor, reader }`。根目录 `package.json` 提供跨子项目的**顺序编排脚本**（按依赖序调各子目录，不使用 npm workspaces），常用流程都从仓库根目录一条命令跑通。各子项目仍可 `cd` 进去单独操作。

一次装好所有子项目依赖：

```bash
npm run install:all
```

构建公共地基（engine + player，按依赖序各自产出 `dist/`，含 `player/dist/styles.css`）：

```bash
npm run build:core
```

跑通示例故事《雾港之夜》（终端播放器）：

```bash
cd engine && npm run play -- ../samples/雾港之夜
```

全仓库测试 / 类型检查：

```bash
npm test          # 各子项目 vitest 依次跑
npm run typecheck # 各子项目 tsc --noEmit 依次跑
```

### 阅读器（浏览器）

```bash
npm run dev:web-reader   # 自动先 build:core，再起 web-reader 开发服务器（打开终端给出的本地 URL）
```

### 编辑器（Tauri 2 桌面端）

editor 是 Tauri 桌面应用，前端复用 `@kiny/player`（其又依赖 `@kiny/engine`），Rust 外壳负责文件/对话框/asset 协议。前置：Rust 工具链（[rustup](https://rustup.rs/)）+ Node。

```bash
npm run dev:editor       # 自动先 build:core，再起 Tauri 开发模式（首次会拉取并编译 Rust crate）
```

仓库在 `samples/雾港之夜/` 提供样例项目《雾港之夜》，可在编辑器里直接打开试写/预览。

### 阅读器（Tauri 2 桌面端）

reader 是通用 Kiny 阅读器，读者拖入或导入 `.kip`（kin 项目的 zip 打包）→ 持久书架 → 阅读屏复用受控 `<Player>`。前置：Rust 工具链（[rustup](https://rustup.rs/)）+ Node。

```bash
npm run dev:reader       # 自动先 build:core，再起 reader 的 Tauri 开发模式
```

### 打包 Windows 安装包

前置：Rust 工具链（msvc target）+ Visual Studio Build Tools（勾选「使用 C++ 的桌面开发」）+ WebView2 运行时（Win10/11 多数已自带）。

```bash
npm run tauri:build          # 自动先 build:core，再跑 editor 的 tauri build
npm run tauri:build:reader   # 自动先 build:core，再跑 reader 的 tauri build
```

editor 产物（NSIS 安装器 + MSI）：

```
editor/src-tauri/target/release/bundle/nsis/kiny-editor_0.1.0_x64-setup.exe
editor/src-tauri/target/release/bundle/msi/kiny-editor_0.1.0_x64_en-US.msi
```

`tauri dev` / `tauri build` 跨平台可用，已在 macOS 与 Windows 验证。

## 目录布局

```
kiny/
├── package.json # 跨子项目的顺序编排脚本（install:all / build:core / tauri:build 等；非 workspace）
├── docs/        # 规范与设计文档（见下）
├── engine/      # TypeScript — parser + analyze + runtime + cli（@kiny/engine）
├── player/      # 平台无关的 React 播放层（@kiny/player，复用 engine）
├── web-reader/  # Vite + React web 阅读器（@kiny/web-reader，复用 player）
├── editor/      # Tauri 2 桌面端编辑器（@kiny/editor，复用 engine + player）
├── reader/      # Tauri 2 桌面端通用阅读器（@kiny/reader，复用 player）
├── samples/     # 真实 .kin 故事样例，顺便压测引擎
└── scripts/     # 构建/发布脚本（release 打包、样例 staging）
```

依赖关系：`engine ← player ← { web-reader, editor, reader }`。`engine/src/` 是一条「编译器前端 + 解释器」流水线：`parser/`（文本 → AST）→ `analyze/`（跨文件语义检查）→ `runtime/`（有状态执行）→ `project/` + `cli/`（加载项目、终端播放）。`player/` 在 engine 之上封装平台无关的 driver / host 与受控 `<Player>` 组件，web-reader / editor / reader 各自只补外壳。

## 文档导航

`docs/reference/` 是语言规范与各层架构 spec 的长期唯一真相源：

| 文档 | 内容 |
|---|---|
| [`reference/kin_spec_draft.md`](docs/reference/kin_spec_draft.md) | **语言规范** —— Kiny DSL 的语法与语义（唯一真相源） |
| [`reference/engine-m1-design.md`](docs/reference/engine-m1-design.md) | engine 整体架构与范围 |
| [`reference/engine-parser-spec.md`](docs/reference/engine-parser-spec.md) | parser 规范（四趟流水线） |
| [`reference/engine-ast-spec.md`](docs/reference/engine-ast-spec.md) | AST 契约（parser ↔ analyze/runtime） |
| [`reference/engine-rawblock-spec.md`](docs/reference/engine-rawblock-spec.md) | parser 内部 pass 2 的 RawBlock 中间表示契约 |
| [`reference/engine-analyze-spec.md`](docs/reference/engine-analyze-spec.md) | analyze 规范（静态检查） |
| [`reference/engine-runtime-spec.md`](docs/reference/engine-runtime-spec.md) | runtime 规范（状态机执行语义） |
| [`reference/engine-cli-spec.md`](docs/reference/engine-cli-spec.md) | CLI 终端播放器规范（项目加载 + 播放循环） |
| [`reference/engine-packaging-spec.md`](docs/reference/engine-packaging-spec.md) | engine 公共 API 与构建（库化对外契约） |

> `docs/reference/` 是**最终态文档**：每次修订直接呈现当前设计，不保留历史对比。设计的演进过程由 git 历史承载。
