import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getVersion } from '@tauri-apps/api/app'
import { installGlobalHandlers, configureErrorReport, ErrorBoundary } from '@kiny/error-report'
import { App } from './App'
import { tauriFileGateway } from './files/tauriGateway'
import { installContextMenuGuard } from './contextMenuGuard'
import '@kiny/player/styles.css'
import './styles.css'

installContextMenuGuard()
// 运行时错误收集：装全局未捕获处理器 + 注入应用元信息（版本异步取，失败留默认）。
installGlobalHandlers({ appName: 'Kiny 编辑器' })
getVersion()
  .then((v) => configureErrorReport({ appVersion: v }))
  .catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App gateway={tauriFileGateway} />
    </ErrorBoundary>
  </StrictMode>,
)
