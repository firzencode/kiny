<p align="center">
  <img src="banner.webp" alt="Kiny — Interactive Fiction Engine" width="480">
</p>

# Kiny

> **简体中文** · [English](README.en.md)

**Kiny** 是一种受 [Ink](https://www.inklestudios.com/ink/) 启发的互动叙事 DSL，定位「Ink 的更简洁版本」：作者优先、中文友好、跨平台。故事文件用 `.kin` 扩展名。

目标产物是一整套生态：**引擎**（读 `.kin`、跑故事）、**阅读器**（玩家读故事）、**编辑器**（作者写故事）。

## 功能特性

### 语言 & 引擎（`@kiny/engine`）

- **`.kin` DSL**——节点 / 子节点（`=== 节点 ===` · `= 子节点`，支持带参 `=== 节点(a, b) ===`）、一次性 / 粘性选项（`* / +`，可带条件与标签）、变量与赋值（`~ let/const`，支持完整 JS 运算符）、条件分支（`@if / @elif / @else`）、带参跳转（`-> 目标(args)`）、`{表达式}` 插值、内联富文本（`<b><i><u><s><color><size><br>`）、变体函数（`seq / cycle / once / shuffle`）、背景与 BGM 命令（`@bg_show / @bgm_play …`）。
- **跨文件静态检查**——节点名 / 标签唯一性、跳转目标与参数个数、变量声明引用一致性与作用域、富文本闭合等，编译期即报错并定位到文件:行号。
- **有状态 runtime**——逐步推进叙事 + 选项分支；完整状态快照，支持存档 / 读档与确定性随机（`--seed`）。
- **终端播放器**——一条命令在终端交互式跑通整篇故事。
- **可作为库复用**——`@kiny/engine` 导出 `parse / analyze / createStory / restoreStory / loadProjectFromFiles` 等公共 API，可嵌入自己的应用。

### 阅读器

- **web-reader（浏览器）**——加载自包含的导出网页，`file://` 双击即开、可脱机运行；选项点击、背景与 BGM 效果。
- **reader（桌面端，Tauri 2）**——拖入或导入 `.kip`（kin 项目的 zip 打包）→ 持久书架管理（可删）→ 阅读屏复用受控 `<Player>`；自动续读 + 多槽手动存档（读 / 删 / 加标签）。

### 编辑器（editor，桌面端，Tauri 2）

- **写故事的 IDE**——CodeMirror 6 语法高亮、编辑时实时增量 lint / 诊断、节点大纲导航、多文件树 + 多 tab。
- **实时预览**——边写边看，确定性重放当前故事；编译出错时降级保留上一有效版本。
- **一键导出**——导出独立自包含网页（注入故事数据 + 拷贝资源，脱机可玩）、导出 `.kip`（供 reader 导入）。
- **省心**——会话恢复、自动保存、深 / 浅色主题切换。

## 如何编译

**前置依赖**：

- **Node**（全部子项目）。
- **Rust 工具链**（[rustup](https://rustup.rs/)）——editor / reader 的桌面端需要。
- 打 Windows 安装包另需 **Visual Studio Build Tools**（勾选「使用 C++ 的桌面开发」）+ **WebView2 运行时**（Win10/11 多数已自带）。

仓库是多子项目布局，依赖链 `engine ← player ← { web-reader, editor, reader }`，editor / reader 另依赖 `error-report`。根目录 `package.json` 提供跨子项目的**顺序编排脚本**（按依赖序调各子目录，不使用 npm workspaces），常用流程都从仓库根目录一条命令跑通。

```bash
# 1. 装好所有子项目依赖
npm run install:all

# 2. 构建公共地基（engine → player → error-report，各自产出 dist/）
npm run build:core

# 3. 构建某个应用（下游构建会自动先 build:core）
npm run build:web-reader        # 浏览器阅读器静态产物
npm run tauri:build             # editor 的桌面端安装包
npm run tauri:build:reader      # reader 的桌面端安装包
```

editor 的 Windows 产物（NSIS 安装器 + MSI，`<version>` 为当前版本）：

```
editor/src-tauri/target/release/bundle/nsis/kiny-editor_<version>_x64-setup.exe
editor/src-tauri/target/release/bundle/msi/kiny-editor_<version>_x64_en-US.msi
```

`tauri dev` / `tauri build` 跨平台可用，已在 macOS 与 Windows 验证。

## 如何使用

**终端跑通样例故事《雾港之夜》**：

```bash
npm run play -- ../samples/雾港之夜   # 路径相对 engine/（根 play 把参数透传给 engine 的 cli）
```

**浏览器里读 / 开发**：

```bash
npm run dev:web-reader   # 自动先 build:core，再起开发服务器（打开终端给出的本地 URL）
```

**用编辑器写故事**：

```bash
npm run dev:editor       # 自动先 build:core，再起 Tauri 开发模式
```

仓库在 `samples/雾港之夜/` 提供样例项目，可在编辑器里直接打开试写 / 预览，并导出独立网页或 `.kip`。

**用阅读器读 `.kip`**：

```bash
npm run dev:reader       # 自动先 build:core，再起 Tauri 开发模式
```

把作者导出的 `.kip` 拖入窗口或从菜单导入，即可加入书架阅读。

## 目录布局

```
kiny/
├── package.json   # 跨子项目的顺序编排脚本（install:all / build:core / tauri:build 等；非 workspace）
├── engine/        # TypeScript 引擎：parser + analyze + runtime + cli（@kiny/engine）
├── player/        # 平台无关的 React 播放层（@kiny/player，复用 engine）
├── error-report/  # editor / reader 共享的运行时错误收集库（@kiny/error-report）
├── web-reader/    # Vite + React 浏览器阅读器（@kiny/web-reader，复用 engine + player）
├── editor/        # Tauri 2 桌面端编辑器（@kiny/editor，复用 engine + player + error-report）
├── reader/        # Tauri 2 桌面端通用阅读器（@kiny/reader，复用 engine + player + error-report）
├── samples/       # 真实 .kin 故事样例，顺便压测引擎
└── docs/reference/ # 语言规范（长期唯一真相源）
```

依赖关系：`engine ← player ← { web-reader, editor, reader }`，editor / reader 另依赖 `error-report`。`engine/src/` 是一条「编译器前端 + 解释器」流水线：`parser/`（文本 → AST）→ `analyze/`（跨文件语义检查）→ `runtime/`（有状态执行）→ `project/` + `cli/`（加载项目、终端播放）。`player/` 在 engine 之上封装平台无关的 driver / host 与受控 `<Player>` 组件，web-reader / editor / reader 各自只补外壳。

## 文档导航

| 文档 | 内容 |
|---|---|
| [`reference/kin_spec_draft.md`](docs/reference/kin_spec_draft.md) | **语言规范** —— Kiny DSL 的语法与语义（唯一真相源） |
