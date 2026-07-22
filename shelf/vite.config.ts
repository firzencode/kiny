import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// shelf 是部署到自有网站的书库应用：无 demo 铺陈、无内联注入、无导出模板（那些是 viewer 的活）。
// base './'：产物用相对路径引用，丢到域名根 / 任意子目录 / GitHub Pages 项目站都能直接跑，无需改配置
//（shelf 无前端路由，相对 base 无深链刷新问题）。
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
