import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 生成 editor「导出独立网页」用的 web-reader 空壳模板，并作为 Tauri resource 落到 editor。
 *
 * 流程（与 web-reader 同源，改了 web-reader 重跑即同步）：
 *  1. `web-reader` 跑 `build:template`（`vite build --mode template`）——单文件内联 JS bundle、
 *     相对 base、不打包 demo，产物 `web-reader/dist-template/index.html`。
 *  2. 在 `<head>` 注入 `window.__KINY_PROJECT__` 占位（先于 body 末尾的 bundle 执行）：
 *     导出时 Rust 把占位字符串 `"__KINY_PROJECT_DATA__"` 替换为实际内联数据；未注入则保持
 *     字符串、web-reader 的 loadStory 识别为非内联、回退 fetch（空壳无 demo，仅占位安全）。
 *  3. 写到 `editor/src-tauri/resources/export-template/index.html`（gitignored 构建产物）。
 *
 * 前置：engine/player 已 `build:core`（web-reader 依赖其 dist）。
 * 钩子接线：editor `prebuild` → `tauri build` 自动备模板（每次刷新）；editor `predev`
 * 带 `--if-missing` → `tauri dev` 的 beforeDevCommand(`npm run dev`) 触发，缺则生成、有则跳过
 * （避免每次 dev 启动都重建，新 worktree 首次仍自动备好）。
 *
 * `--if-missing`：输出已存在则跳过（dev 用，省每次重建开销）；不带则无条件重建（build 用，保新鲜）。
 */
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const webReader = join(repoRoot, 'web-reader')
const distIndex = join(webReader, 'dist-template', 'index.html')
const outDir = join(repoRoot, 'editor', 'src-tauri', 'resources', 'export-template')
const outIndex = join(outDir, 'index.html')

if (process.argv.includes('--if-missing') && existsSync(outIndex)) {
  console.log(`[build-export-template] 模板已存在，跳过：${outIndex}`)
  process.exit(0)
}

console.log('[build-export-template] 构建 web-reader 空壳模板（vite build --mode template）...')
execSync('npm run build:template', { cwd: webReader, stdio: 'inherit' })

const PLACEHOLDER = '<script>window.__KINY_PROJECT__ = "__KINY_PROJECT_DATA__";</script>'
let html = readFileSync(distIndex, 'utf8')
if (!html.includes('__KINY_PROJECT_DATA__')) {
  if (!html.includes('<head>')) throw new Error('模板缺 <head>，无法注入 __KINY_PROJECT__ 占位')
  html = html.replace('<head>', `<head>\n    ${PLACEHOLDER}`)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outIndex, html, 'utf8')
console.log(`[build-export-template] 模板就位：${outIndex}`)
