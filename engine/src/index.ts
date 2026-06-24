// parser
export { parse, ParseError } from './parser'
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
export type { OutputEvent, ChoiceView, StoryOptions, StorySnapshot, RichSpan } from './runtime'
// project（点名纯子模块，loadProject 已移出 engine）
export { validateManifest } from './project/manifest'
export { assembleProject } from './project/assemble'
export { loadProjectFromFiles } from './project/memory'
export type { KinyMeta, LoadResult, ProjectError } from './project/types'
