<p align="center">
  <img src="banner.webp" alt="Kiny — Interactive Fiction Engine" width="480">
</p>

# Kiny

> [简体中文](README.md) · **English**

**Kiny** is an interactive-narrative DSL inspired by [Ink](https://www.inklestudios.com/ink/), positioned as "a leaner version of Ink": author-first, friendly to Chinese, cross-platform. Story files use the `.kin` extension.

The goal is a whole ecosystem: an **engine** (reads `.kin`, runs the story), a **reader** (players read the story), and an **editor** (authors write the story).

## Features

### Language & engine (`@kiny/engine`)

- **The `.kin` DSL** — knots / stitches (`=== knot ===` · `= stitch`, with parameters `=== knot(a, b) ===`), once-only / sticky choices (`* / +`, with conditions and labels), variables and assignment (`~ let/const`, full JS operators), conditional blocks (`@if / @elif / @else`), parameterized diverts (`-> target(args)`), `{expression}` interpolation, inline rich text (`<b><i><u><s><color><size><br>`), variant functions (`seq / cycle / once / shuffle`), and background / BGM commands (`@bg_show / @bgm_play …`).
- **Cross-file static checks** — knot / label uniqueness, divert targets and argument counts, variable declaration-vs-use consistency and scope, rich-text closing, and more — reported at compile time with file:line locations.
- **Stateful runtime** — steps the narrative forward with branching choices; full state snapshots enable save / load and deterministic randomness (`--seed`).
- **Terminal player** — play a whole story interactively in the terminal with one command.
- **Reusable as a library** — `@kiny/engine` exports a public API (`parse / analyze / createStory / restoreStory / loadProjectFromFiles`, …) to embed in your own app.

### Readers

- **web-reader (browser)** — loads a self-contained exported web page; double-click to open over `file://` and run offline; choice clicks, background and BGM effects.
- **reader (desktop, Tauri 2)** — drag in or import a `.kip` (a zip package of a kin project) → a persistent, manageable bookshelf → the reading screen reuses the controlled `<Player>`; auto-continue plus multiple manual save slots (load / delete / label).

### Editor (desktop, Tauri 2)

- **An IDE for writing stories** — CodeMirror 6 syntax highlighting, live incremental lint / diagnostics, a knot outline, a multi-file tree and multiple tabs.
- **Live preview** — see your story as you write via deterministic replay; on a compile error it degrades gracefully and keeps the last valid version.
- **One-click export** — export a self-contained web page (injects the story data + copies assets, playable offline) and export a `.kip` (for the reader to import).
- **Quality of life** — session restore, autosave, and light / dark theme switching.

## How to build

**Prerequisites:**

- **Node** (all subprojects).
- **The Rust toolchain** ([rustup](https://rustup.rs/)) — needed for the editor / reader desktop apps.
- Building a Windows installer also needs **Visual Studio Build Tools** (with "Desktop development with C++") + the **WebView2 runtime** (already bundled on most Win10/11).

The repository is a multi-subproject layout with the dependency chain `engine ← player ← { web-reader, editor, reader }`; the editor / reader also depend on `error-report`. The root `package.json` provides **sequential orchestration scripts** across subprojects (calling each subdirectory in dependency order; it does not use npm workspaces), so the common workflows run with a single command from the repo root.

```bash
# 1. Install all subproject dependencies
npm run install:all

# 2. Build the shared foundation (engine → player → error-report, each emitting its dist/)
npm run build:core

# 3. Build an app (downstream builds auto-run build:core first)
npm run build:web-reader        # the browser reader's static output
npm run tauri:build             # the editor's desktop installer
npm run tauri:build:reader      # the reader's desktop installer
```

The editor's Windows artifacts (NSIS installer + MSI; `<version>` is the current version):

```
editor/src-tauri/target/release/bundle/nsis/kiny-editor_<version>_x64-setup.exe
editor/src-tauri/target/release/bundle/msi/kiny-editor_<version>_x64_en-US.msi
```

`tauri dev` / `tauri build` work cross-platform, verified on macOS and Windows.

## How to use

**Play the sample story "Night at the Foggy Harbor" in the terminal:**

```bash
npm run play -- ../samples/雾港之夜   # path is relative to engine/ (the root play forwards args to engine's cli)
```

**Read / develop in the browser:**

```bash
npm run dev:web-reader   # auto-runs build:core first, then starts the dev server (open the local URL printed in the terminal)
```

**Write a story in the editor:**

```bash
npm run dev:editor       # auto-runs build:core first, then starts Tauri dev mode
```

The repository ships a sample project under `samples/雾港之夜/`, which you can open directly in the editor to try writing / previewing, then export as a self-contained web page or a `.kip`.

**Read a `.kip` in the reader:**

```bash
npm run dev:reader       # auto-runs build:core first, then starts Tauri dev mode
```

Drag an author's exported `.kip` into the window or import it from the menu to add it to your bookshelf.

## Directory layout

```
kiny/
├── package.json   # sequential orchestration scripts across subprojects (install:all / build:core / tauri:build, etc.; not a workspace)
├── engine/        # TypeScript engine: parser + analyze + runtime + cli (@kiny/engine)
├── player/        # platform-agnostic React player layer (@kiny/player, reuses engine)
├── error-report/  # runtime error-collection library shared by editor / reader (@kiny/error-report)
├── web-reader/    # Vite + React browser reader (@kiny/web-reader, reuses engine + player)
├── editor/        # Tauri 2 desktop editor (@kiny/editor, reuses engine + player + error-report)
├── reader/        # Tauri 2 desktop universal reader (@kiny/reader, reuses engine + player + error-report)
├── samples/       # real .kin story samples that also stress-test the engine
└── docs/reference/ # the language spec (the single long-term source of truth)
```

Dependencies: `engine ← player ← { web-reader, editor, reader }`; the editor / reader also depend on `error-report`. `engine/src/` is a "compiler front end + interpreter" pipeline: `parser/` (text → AST) → `analyze/` (cross-file semantic checks) → `runtime/` (stateful execution) → `project/` + `cli/` (load a project, play in the terminal). `player/` wraps a platform-agnostic driver / host and the controlled `<Player>` component on top of the engine; web-reader / editor / reader each add only their shell.

## Documentation

| Document | Contents |
|---|---|
| [`reference/kin_spec_draft.md`](docs/reference/kin_spec_draft.md) | **Language spec** — the syntax and semantics of the Kiny DSL (the single source of truth) |
