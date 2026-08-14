/**
 * **e2e 专用入口**（浏览器里跑真编辑器）。生产 / Tauri 构建一字不含——只有
 * `vite build --mode e2e` 会把 `e2e.html` 作为入口带上它。
 *
 * 为什么需要它：editor 的一部分行为**只有真浏览器验得了**。最典型的是作品 CSS 的作用域
 * 隔离（T094）——jsdom 不算样式，字符串等值断言测的是「实现对 CSS 的理解」而不是 CSS
 * 本身，真漏就是这么溜过去的。有了这个入口，e2e 才能读到真实的 computed style。
 *
 * 与 `main.tsx` 的差别：gateway 换成内存实现（不碰 Tauri）、项目内容由 URL 参数注入，
 * 且不装 Tauri 相关的那几件（版本注入、右键菜单守卫）。`App`、样式与 DOM 结构与生产
 * 完全同一份，否则测的就不是真编辑器了。`ErrorBoundary` 保留——渲染崩溃时给一屏可读的
 * 错误，胜过白屏加 30 秒定位超时。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@kiny/error-report'
import { App } from './App'
import { createMemoryGateway } from './files/memoryGateway'
import '@kiny/player/styles.css'
import './styles.css'

const MAIN = `开场白：雾港的夜。
* [向左] -> 左
* [向右] -> 右
=== 左 ===
你往左走。
-> END
=== 右 ===
你往右走。
-> END
`

const params = new URLSearchParams(location.search)
/** 作品 css（`?css=` 传，URL 编码）。不传则项目内无 `.css`，预览走编辑器默认皮肤。 */
const projectCss = params.get('css') ?? ''
/** 角色表原文（`?characters=` 传）。不传则项目内无 `characters.json`，正文不着色。 */
const charactersJson = params.get('characters') ?? ''
/** 故事正文（`?kin=` 传）。不传用上面那份默认脚本。 */
const mainKin = params.get('kin') ?? MAIN

// manifest 用当前形态的 `<项目名>.kiw`，不用 legacy 的 `kiny.json`——否则每次 e2e 都在跑
// 迁移分支，测不到今天真实的加载路径。
const files: Record<string, string> = {
  '/proj/雾港之夜.kiw': JSON.stringify({ name: '雾港之夜', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
  '/proj/main.kin': mainKin,
}
if (projectCss !== '') files['/proj/theme.css'] = projectCss
if (charactersJson !== '') files['/proj/characters.json'] = charactersJson

// 每次加载从干净状态起步：设置 / 会话 / 草稿都存在 localStorage，跨用例残留会让断言随
// 执行顺序漂移。本入口不测持久化，清掉最可预测。
localStorage.clear()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App gateway={createMemoryGateway({ pickedDir: '/proj', files })} />
    </ErrorBoundary>
  </StrictMode>,
)
