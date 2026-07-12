import '@testing-library/jest-dom'
// jsdom 未实现 scrollIntoView —— 桩成空操作，供 StoryLog 自动滚到底
Element.prototype.scrollIntoView = () => {}
// jsdom 未实现 matchMedia —— 桩成「减弱动态效果」开启，令打字机揭示瞬显（内容断言同步、不依赖 timer）。
window.matchMedia = (q: string) =>
  ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } }) as unknown as MediaQueryList
