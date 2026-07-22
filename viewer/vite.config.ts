import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `--mode template`：editor 导出独立网页的空壳模板——单文件内联 JS bundle、相对 base、
// 不打包 public（demo），产物 dist-template/index.html 供 build-export-template.mjs 后处理。
// 其余（dev / 线上 demo build / vitest）保持原样。
export default defineConfig(({ mode }) => {
  const template = mode === 'template'
  return {
    base: template ? './' : '/',
    publicDir: template ? false : 'public',
    plugins: [react(), ...(template ? [viteSingleFile()] : [])],
    build: template ? { outDir: 'dist-template', emptyOutDir: true } : {},
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
    },
  }
})
