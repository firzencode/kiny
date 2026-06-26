import '@testing-library/jest-dom'
Element.prototype.scrollIntoView = () => {}

// jsdom 不实现文本测量（Range.getClientRects / getBoundingClientRect）。CodeMirror 6 的
// 视图测量会调到它们，缺失时 measureTextSize 抛 "getClientRects is not a function"。
// 给个零尺寸兜底：测试只验状态/逻辑（doc、selection、回调），不依赖真实排版几何。
const emptyRectList = { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList
const zeroRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => emptyRectList
  Range.prototype.getBoundingClientRect = () => zeroRect
}
