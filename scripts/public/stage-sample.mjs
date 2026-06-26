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
    // 只列顶层 .kin（样例项目约定 .kin 平铺在根，assets 等子目录不含源文件）。
    const kins = readdirSync(destDir).filter((f) => f.endsWith('.kin')).sort()
    writeFileSync(join(destDir, 'files.json'), JSON.stringify(kins) + '\n', 'utf8')
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
