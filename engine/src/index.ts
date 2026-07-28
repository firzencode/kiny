// parser
export { parse, ParseError } from './parser'
export { validFont, validClass } from './parser/inline'
export { sortByPath } from './order'
export type {
  ProjectFile, Knot, Stitch, ContentBlock, ContentElement, TextLine, Divert,
  ChoiceGroup, Choice, Conditional, ConditionalBranch, LogicLine, LogicBlock,
  Command, InlineSegment, InlineStyle, RichTextIssue,
} from './parser'
// analyze
export { analyze, resolveStart, openingKnotName } from './analyze'
export type { Diagnostic, AnalyzeResult, ValidatedProgram } from './analyze'
// runtime
export { createStory, restoreStory, Story, RuntimeError, plainText } from './runtime'
export type { OutputEvent, ChoiceView, StoryOptions, StorySnapshot, RichSpan, PanelSlot } from './runtime'
// project（点名纯子模块，loadProject 已移出 engine）
export { validateManifest } from './project/manifest'
export { assembleProject } from './project/assemble'
export { loadProjectFromFiles } from './project/memory'
export { findManifest } from './project/locate'
export type { KinyMeta, LoadResult, ProjectError } from './project/types'
// 公共装配流水线（manifest 文本 + 文件集 → Story），三端薄封装共用
export { assembleFromFiles } from './assemble-story'
export type { AssembleOptions, AssembleResult, AssembleWarning } from './assemble-story'
