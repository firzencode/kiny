import React from 'react'
import ReactDOM from 'react-dom/client'
import { getVersion } from '@tauri-apps/api/app'
import { installGlobalHandlers, configureErrorReport, ErrorBoundary } from '@kiny/error-report'
import '@kiny/player/styles.css'
import './styles.css'
import { App } from './App'

// 运行时错误收集：装全局未捕获处理器 + 注入应用元信息（版本异步取，失败留默认）。
installGlobalHandlers({ appName: 'Kiny 阅读器' })
getVersion()
  .then((v) => configureErrorReport({ appVersion: v }))
  .catch(() => {})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
