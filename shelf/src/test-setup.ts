import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'
// jsdom 未实现 scrollIntoView —— 桩成空操作，供 player 的 StoryLog 自动滚到底。
Element.prototype.scrollIntoView = () => {}
// jsdom 未实现 matchMedia —— 桩成「减弱动态效果」开启，令打字机揭示瞬显（内容断言同步、不依赖 timer）。
window.matchMedia = (q: string) =>
  ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } }) as unknown as MediaQueryList
// jsdom 未实现 URL.createObjectURL / revokeObjectURL —— 桩成可辨识的假 blob URL（资源解析测试用）。
let __blobN = 0
URL.createObjectURL = () => `blob:mock/${__blobN++}`
URL.revokeObjectURL = () => {}
// jsdom 未实现 Blob/File.prototype.arrayBuffer —— 借 FileReader 补齐（App 导入 .kip 靠 file.arrayBuffer() 读字节）。
// 须在下方替换全局 Blob 前打，否则补的是错的 prototype——File 仍继承 jsdom 原 Blob.prototype。
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error as unknown as Error)
      reader.readAsArrayBuffer(this)
    })
  }
}
// jsdom 的 Blob 实现与 Node 原生 structuredClone 不识别彼此（fake-indexeddb 落库走 structuredClone，
// 遇 jsdom Blob 会静默丢成 {}——https://github.com/dumbmatter/fakeIndexedDB/issues/88）。
// 用 Node 原生 Blob 顶替全局 Blob，令浏览器端 `new Blob(...)`（书库封面等）产出可被 IndexedDB 正确克隆的实例；
// File 由 jsdom 单独实现、不受此替换影响，上面已单独补好 arrayBuffer。
import { Blob as NodeBlob } from 'node:buffer'
globalThis.Blob = NodeBlob as unknown as typeof Blob
