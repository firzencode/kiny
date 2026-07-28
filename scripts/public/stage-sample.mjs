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
    // 浏览器无法枚举目录，故 files.json 显式列出项目的**全部**文件（递归，'/' 分隔的相对路径）：
    // viewer loadDemo 用 findManifest 挑 manifest、`.kin` 作故事文件、`.css` 与字体按前端资源规则
    // 自动加载，其余（图片 / 音频）只在被引用时按需取。跳过 `.` 开头的路径段与 node_modules
    // （与 player 的资源发现规则一致）。
    const all = []
    const walk = (abs, rel) => {
      for (const ent of readdirSync(abs, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
        const childRel = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) walk(join(abs, ent.name), childRel)
        else if (ent.isFile()) all.push(childRel)
      }
    }
    walk(destDir, '')
    all.sort()
    // 选名规则与 engine findManifest 等价（自包含内联，不引 engine dist）：.kiw 优先，回退 kiny.json。
    // manifest 位于项目根，故只在顶层条目里找。
    const roots = all.filter((f) => !f.includes('/'))
    const manifest = roots.find((f) => f.endsWith('.kiw')) ?? (roots.includes('kiny.json') ? 'kiny.json' : undefined)
    const list = manifest ? [manifest, ...all.filter((f) => f !== manifest)] : all
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
