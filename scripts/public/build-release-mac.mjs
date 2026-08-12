import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 一键编译 editor / reader 的 macOS release，并把发布资产汇总到仓库根 output/。
 *
 * macOS 上 `tauri build` 默认产出 .app + .dmg（bundle.targets 为 "all"），本脚本
 * 按当前版本号收集 .dmg 到 output/（.app 已包含在 .dmg 内，无需单独收集）。
 * output/ 每次先清空再填；该目录已在 .gitignore。tauri 的 bundle 目录会累积
 * 历次旧版产物，故收集时按版本号过滤（同 build-release.mjs 的 collect 逻辑）。
 *
 * 注意：产物默认 ad-hoc 签名、未公证；本机使用无碍，对外分发需另行签名公证。
 *
 * 用法：
 *   node scripts/public/build-release-mac.mjs          # editor + reader
 *   node scripts/public/build-release-mac.mjs editor   # 只编 editor
 *   node scripts/public/build-release-mac.mjs reader   # 只编 reader
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KNOWN_APPS = ['editor', 'reader']
// 当前发布版本（真相源根 package.json）。只收集带当前版本号的 dmg，避免混入旧版产物。
const VERSION = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

function run(cmd, args) {
  // macOS 上 npm 直接可执行，无需 shell 解析 npm.cmd（Windows 脚本才需要 shell）。
  execFileSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' })
}

function collect(app, outDir) {
  const bundleDir = join(repoRoot, app, 'src-tauri', 'target', 'release', 'bundle')
  let n = 0
  const dmgDir = join(bundleDir, 'dmg')
  if (!existsSync(dmgDir)) {
    console.warn(`  ⚠ ${app}: 未找到 dmg 目录，跳过`)
    return 0
  }
  for (const f of readdirSync(dmgDir)) {
    if (!f.endsWith('.dmg')) continue
    // bundle 目录残留历次旧版产物，只收当前版本的 dmg。
    if (!f.includes(`_${VERSION}_`)) continue
    cpSync(join(dmgDir, f), join(outDir, f))
    console.log(`  ✓ ${app}/dmg/${f}`)
    n++
  }
  if (n === 0) console.warn(`  ⚠ ${app}: 未找到 ${VERSION} 的 dmg，跳过`)
  return n
}

function main() {
  const argv = process.argv.slice(2)
  const apps = argv.filter((a) => KNOWN_APPS.includes(a))
  const targets = apps.length ? apps : KNOWN_APPS

  const outDir = join(repoRoot, 'output')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // engine/player 是 file: 依赖，先出 dist，下游 tauri build 才能解析。
  console.log('==> build:core')
  run('npm', ['run', 'build:core'])

  let total = 0
  for (const app of targets) {
    console.log(`\n==> 打包 ${app}`)
    run('npm', ['--prefix', app, 'run', 'tauri', 'build'])
    console.log(`==> 汇总 ${app} 产物 -> output/`)
    total += collect(app, outDir)
  }

  console.log(`\n完成：${total} 份发布资产已汇总到 ${outDir}`)
}

main()
