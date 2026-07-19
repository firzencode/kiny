import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planPortable, readmeText } from './portable.mjs'

/**
 * 一键编译 editor / reader 的 Windows release，并把发布资产汇总到仓库根 output/。
 *
 * 两类资产：
 *  - NSIS 安装包（默认只打 setup.exe，不要 MSI；传 `--bundles all` 恢复全部 bundle）。
 *  - 免安装 portable zip（editor / reader 各一份，解压即用；传 `--no-portable` 跳过）。
 *    portable 取裸 cargo 产物 src-tauri/target/release/<品牌名>.exe（package 名已改为
 *    kiny-editor / kiny-reader，故天然不撞名），随附 bundle.resources 声明的外部资源
 *    （editor 的 export-template）与中文使用说明，压成 zip。
 * output/ 每次先清空再填；该目录已在 .gitignore。注意 tauri 的 bundle 目录本身
 * 会累积历次旧版安装包，故汇总时按当前版本号过滤（见 collect），只收本次产物。
 *
 * 用法：
 *   node scripts/public/build-release.mjs                  # editor + reader，NSIS + portable
 *   node scripts/public/build-release.mjs editor           # 只编 editor
 *   node scripts/public/build-release.mjs reader --bundles nsis   # 只 reader、只打 nsis
 *   node scripts/public/build-release.mjs --no-portable    # 只出 NSIS，不打 portable zip
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

// 读某 app tauri.conf.json 的 bundle.resources（外部资源相对路径数组；缺则空）。
function appResources(app) {
  const conf = JSON.parse(
    readFileSync(join(repoRoot, app, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  )
  return conf.bundle?.resources ?? []
}

// 把 staging 文件夹压成 zip（保留 UTF-8 条目名，免中文文件名乱码）。Windows 上经 PowerShell
// 的 .NET ZipFile，传 UTF8 entryNameEncoding（Compress-Archive 5.1 不带 UTF-8 标志会乱码）；
// includeBaseDirectory=$true 让 zip 内含一层与文件夹同名的顶层目录（解压得一个免安装文件夹，
// 而非散落到当前目录）。
function zipDir(srcDir, destZip) {
  rmSync(destZip, { force: true })
  // PowerShell 单引号字符串里的 ' 需写成 ''（否则路径含 ' 会截断字符串、命令碎）。
  const q = (s) => s.replace(/'/g, "''")
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory(',
    `'${q(srcDir)}', '${q(destZip)}',`,
    '[System.IO.Compression.CompressionLevel]::Optimal, $true,',
    '(New-Object System.Text.UTF8Encoding($false)))',
  ].join(' ')
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

// 组装某 app 的免安装 portable zip 到 output/：裸品牌 exe + 外部资源 + 使用说明。
function assemblePortable(app, outDir) {
  const plan = planPortable(app, VERSION, appResources(app))
  const releaseDir = join(repoRoot, app, 'src-tauri', 'target', 'release')
  const exeSrc = join(releaseDir, plan.exeName)
  if (!existsSync(exeSrc)) {
    console.warn(`  ⚠ ${app}: 未找到裸 exe ${plan.exeName}，跳过 portable`)
    return 0
  }
  // staging 文件夹名即 zip 内顶层目录名（zip 名去 .zip 后缀），解压后即一个干净的品牌文件夹。
  const staging = join(outDir, plan.zipName.replace(/\.zip$/, ''))
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const f of plan.files) {
    const dest = join(staging, f.to)
    mkdirSync(dirname(dest), { recursive: true })
    if (f.role === 'exe') {
      cpSync(exeSrc, dest)
    } else if (f.role === 'resource') {
      cpSync(join(repoRoot, app, 'src-tauri', f.from), dest)
    } else if (f.role === 'readme') {
      writeFileSync(dest, readmeText(app, VERSION), 'utf8')
    }
  }
  zipDir(staging, join(outDir, plan.zipName))
  rmSync(staging, { recursive: true, force: true })
  console.log(`  ✓ ${app}/portable/${plan.zipName}`)
  return 1
}

function main() {
  const argv = process.argv.slice(2)
  const apps = argv.filter((a) => !a.startsWith('--') && KNOWN_APPS.includes(a))
  const targets = apps.length ? apps : KNOWN_APPS
  const bIdx = argv.indexOf('--bundles')
  const bundles = bIdx >= 0 ? argv[bIdx + 1] : 'nsis'  // 默认只打 NSIS setup.exe（不要 MSI）
  const portable = !argv.includes('--no-portable')     // 默认连 portable 一起出

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
    if (portable) {
      console.log(`==> 组装 ${app} 免安装 portable zip -> output/`)
      total += assemblePortable(app, outDir)
    }
  }

  console.log(`\n完成：${total} 份发布资产已汇总到 ${outDir}`)
}

main()
