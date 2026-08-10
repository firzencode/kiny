import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * `--mode e2e` 产出**浏览器 e2e 专用**的一份构建：入口换成 `e2e.html`（内存 gateway，
 * 不碰 Tauri），落在独立的 `dist-e2e/`。生产构建（`npm run build`）走默认 mode，
 * 入口仍只有 `index.html`——e2e 入口与内存 gateway 一字不进 Tauri 包。
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __KINY_VERSION__: JSON.stringify(pkg.version) },
  resolve: { dedupe: ['react', 'react-dom'] },
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  ...(mode === 'e2e'
    ? { build: { outDir: 'dist-e2e', emptyOutDir: true, rollupOptions: { input: at('./e2e.html') } } }
    : {}),
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
}))
