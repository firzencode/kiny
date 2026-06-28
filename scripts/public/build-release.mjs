import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 一键编译 editor / reader 的 Windows release，并把安装包汇总到仓库根 output/。
 *
 * 默认只打 NSIS setup.exe（不要 MSI）；传 `--bundles all` 可恢复全部 bundle。
 * 拷贝对象：各 app 的 src-tauri/target/release/bundle/nsis 下的 .exe 安装包
 * （独立 app.exe 不可分发、且两 app 重名，故不拷）。
 * output/ 每次先清空再填；该目录已在 .gitignore。注意 tauri 的 bundle 目录本身
 * 会累积历次旧版安装包，故汇总时按当前版本号过滤（见 collect），只收本次产物。
 *
 * 用法：
 *   node scripts/public/build-release.mjs                  # editor + reader，全部 bundle
 *   node scripts/public/build-release.mjs editor           # 只编 editor
 *   node scripts/public/build-release.mjs reader --bundles nsis   # 只 reader、只打 nsis
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KNOWN_APPS = ['editor', 'reader']
// 当前发布版本（真相源根 package.json）。tauri 的 bundle 目录会累积历次旧版安装包，
// 故汇总时按版本号过滤，只收本次构建的产物，避免把 0.1.0/0.2.0 旧包混进 output/。
const VERSION = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version

function run(cmd, args) {
  // Windows 上 npm 是 npm.cmd，execFileSync 需 shell 才能解析。
  execFileSync(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: true })
}

function collect(app, outDir) {
  const bundleDir = join(repoRoot, app, 'src-tauri', 'target', 'release', 'bundle')
  let n = 0
  for (const sub of ['nsis', 'msi']) {
    const dir = join(bundleDir, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.exe') && !f.endsWith('.msi')) continue
      // bundle 目录残留历次旧版安装包，只收当前版本的产物。
      if (!f.includes(`_${VERSION}_`)) continue
      cpSync(join(dir, f), join(outDir, f))
      console.log(`  ✓ ${app}/${sub}/${f}`)
      n++
    }
  }
  if (n === 0) console.warn(`  ⚠ ${app}: 未找到任何安装包，跳过`)
  return n
}

function main() {
  const argv = process.argv.slice(2)
  const apps = argv.filter((a) => !a.startsWith('--') && KNOWN_APPS.includes(a))
  const targets = apps.length ? apps : KNOWN_APPS
  const bIdx = argv.indexOf('--bundles')
  const bundles = bIdx >= 0 ? argv[bIdx + 1] : 'nsis'  // 默认只打 NSIS setup.exe（不要 MSI）

  const outDir = join(repoRoot, 'output')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // engine/player 是 file: 依赖，先出 dist，下游 tauri build 才能解析。
  console.log('==> build:core')
  run('npm', ['run', 'build:core'])

  let total = 0
  for (const app of targets) {
    console.log(`\n==> 打包 ${app}${bundles ? ` (--bundles ${bundles})` : ''}`)
    const tauriArgs = ['--prefix', app, 'run', 'tauri', 'build']
    if (bundles) tauriArgs.push('--', '--bundles', bundles)
    run('npm', tauriArgs)
    console.log(`==> 汇总 ${app} 产物 -> output/`)
    total += collect(app, outDir)
  }

  console.log(`\n完成：${total} 个安装包已汇总到 ${outDir}`)
}

main()
