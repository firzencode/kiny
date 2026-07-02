// Windows 免安装 portable 版的 staging 布局规划（纯函数，不碰文件系统，可单测）。
// 输入 app / 版本 / 资源清单 → 输出 zip 名 + staging 内文件布局描述；实际拷贝 / 压缩在
// build-release.mjs 的不纯外壳里做。

// app → 品牌名（裸 cargo 产物的 exe 名，即各 app Cargo.toml 的 [package] name）。
const BRAND = { editor: 'kiny-editor', reader: 'kiny-reader' }

/** app 名 → 品牌名（kiny-editor / kiny-reader）。未知 app 抛错。 */
export function brandOf(app) {
  const brand = BRAND[app]
  if (!brand) throw new Error(`未知 app：${app}（应为 ${Object.keys(BRAND).join(' / ')}）`)
  return brand
}

/**
 * 规划某 app 的 portable staging 布局。
 * @param {string} app 'editor' | 'reader'
 * @param {string} version 版本号（取真相源根 package.json）
 * @param {string[]} resources bundle.resources 声明的资源相对路径（相对 src-tauri，亦即 exe 同目录）
 * @returns {{zipName:string, exeName:string, brand:string, files:Array<{role:string, from?:string, to:string}>}}
 *   - role 'exe'：to = '<brand>.exe'（from 由调用方拼 target/release/<brand>.exe 绝对路径）
 *   - role 'resource'：from = to = 资源相对路径（严格对齐 BaseDirectory::Resource = exe 同目录）
 *   - role 'readme'：to = '使用说明.txt'（内容由 readmeText 生成）
 */
export function planPortable(app, version, resources = []) {
  const brand = brandOf(app)
  const exeName = `${brand}.exe`
  const files = [
    { role: 'exe', to: exeName },
    ...resources.map((r) => ({ role: 'resource', from: r, to: r })),
    { role: 'readme', to: '使用说明.txt' },
  ]
  return { zipName: `${brand}-portable_${version}_x64.zip`, exeName, brand, files }
}

/** portable 文件夹内随附的中文使用说明。 */
export function readmeText(app, version) {
  const brand = brandOf(app)
  const name = app === 'editor' ? 'Kiny 编辑器' : 'Kiny 阅读器'
  return [
    `${name}（免安装版） v${version}`,
    '',
    '使用方法：',
    `  双击 ${brand}.exe 即可运行，无需安装、不写注册表、不需管理员权限。`,
    '',
    '系统要求：',
    '  需要 Microsoft Edge WebView2 运行时（Windows 10 1803+ / Windows 11 已预装）。',
    '  若启动时提示缺少 WebView2，请按提示从微软官网下载安装：',
    '  https://developer.microsoft.com/microsoft-edge/webview2/',
    '',
    '说明：',
    '  免安装版与安装版共用同一份用户数据（%APPDATA%）。',
    '  删除本文件夹不会清除已保存的数据。',
    '',
  ].join('\r\n')
}
