# Changelog

本项目所有值得记录的变更收录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

内部仓条目尾部的 `(!N)` 指向 gitee MR；导出到 GitHub 镜像时该标记会被去除。

## [Unreleased]

## [0.2.0] - 2026-06-24
### Added

- 文本支持内联富文本：粗体 / 斜体 / 下划线 / 删除线、颜色、字号与换行。(!14)
- editor 跟进内联富文本：语法参考新增「内联富文本」一节，编辑器高亮识别富文本标签。(!17)
- editor / reader 运行时错误收集与问题反馈：错误落本地日志、崩溃有兜底页，帮助菜单可一键反馈。(!15)
- editor 可把项目导出成自包含独立网页：file:// 双击即读完整故事（含图片 / 音频），不依赖联网。(!18)

### Changed

- editor 设置弹窗字号 / 行距步进器视觉优化：px 单位独立分格、数字不再跳动。(!16)

## [0.1.0] - 2026-06-21
### Added

- 实现 Kiny DSL 引擎:parser(文本→AST)、analyze(跨文件静态检查)、runtime(状态机执行)与 CLI 终端播放器。
- 支持完整叙事语法:节点/子节点、选项(一次性/粘性/条件/fallback)、`>` 分支汇合、`<>` 粘连、文本变体(`seq`/`cycle`/`once`/`shuffle`)、`@if` 条件块、内联 JS 求值、带参节点、回合数与可复现随机。
- 提供平台无关的 React 播放层 player:受控 `<Player>` 组件、driver/host 抽象、确定性保位重放。
- 支持背景、音频与一次性音效(`@sfx`)命令。
- 实现故事状态快照:`Story.serialize` / `restoreStory` 往返等价。
- 新增浏览器端故事阅读器 web-reader(Vite + React)。
- 新增 Tauri 2 桌面编辑器 editor:多文件项目、文件树增删改/拖拽、跨文件实时校验、保位预览、多 tab 与会话恢复、语义着色、排版与主题设置、`.kip` 故事包导出、未保存守卫。
- 新增 Tauri 2 桌面阅读器 reader:`.kip` 导入(按钮/拖放)、持久书架与阅读屏。
- 内置样例项目《雾港之夜》。
