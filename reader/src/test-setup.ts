import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Mock scrollIntoView in jsdom
Element.prototype.scrollIntoView = vi.fn()

// jsdom 未实现 matchMedia —— 桩成「减弱动态效果」开启，令打字机揭示瞬显（内容断言同步、不依赖 timer）。
window.matchMedia = ((q: string) =>
  ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })) as unknown as typeof window.matchMedia
