import { cpSync, rmSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把样例项目目录整体拷到目标位置；可选生成 files.json（web 侧加载索引）。
 * 目标目录会被先清空再重建，避免残留陈旧文件。
 * @param {string} srcDir 权威源目录
 * @param {string} destDir 目标目录
 * @param {{ filesJson?: boolean }} [opts]
 */
export function stageSample(srcDir, destDir, opts = {}) {
  if (!existsSync(srcDir)) throw new Error(`源目录不存在: ${srcDir}`)
  rmSync(destDir, { recursive: true, force: true })
  cpSync(srcDir, destDir, { recursive: true })
  if (opts.filesJson) {
    // 浏览器无法枚举目录，故 files.json 显式列出根部需 fetch 的文件：manifest（`<名>.kiw` 或旧
    // kiny.json）+ 顶层 .kin（样例约定 .kin 平铺在根，assets 等子目录不含源文件）。web-reader
    // loadDemo 用 findManifest 从这份索引挑 manifest、其余作故事文件。
    const roots = readdirSync(destDir)
    const kins = roots.filter((f) => f.endsWith('.kin')).sort()
    // 选名规则与 engine findManifest 等价（自包含内联，不引 engine dist）：.kiw 优先，回退 kiny.json。
    const manifest = roots.find((f) => f.endsWith('.kiw')) ?? (roots.includes('kiny.json') ? 'kiny.json' : undefined)
    const list = manifest ? [manifest, ...kins] : kins
    writeFileSync(join(destDir, 'files.json'), JSON.stringify(list) + '\n', 'utf8')
  }
}

// CLI: node stage-sample.mjs <srcDir> <destDir> [--files-json]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const [src, dest] = positional
  const filesJson = process.argv.includes('--files-json')
  if (!src || !dest) {
    console.error('用法: node stage-sample.mjs <srcDir> <destDir> [--files-json]')
    process.exit(1)
  }
  stageSample(src, dest, { filesJson })
  console.log(`已 stage: ${src} -> ${dest}${filesJson ? ' (+files.json)' : ''}`)
}
