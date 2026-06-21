import '@testing-library/jest-dom'
// jsdom 未实现 scrollIntoView —— 桩成空操作，供 StoryLog 自动滚到底
Element.prototype.scrollIntoView = () => {}
