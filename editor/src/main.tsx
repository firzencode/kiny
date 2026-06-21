import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { tauriFileGateway } from './files/tauriGateway'
import { installContextMenuGuard } from './contextMenuGuard'
import '@kiny/player/styles.css'
import './styles.css'

installContextMenuGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App gateway={tauriFileGateway} />
  </StrictMode>,
)
