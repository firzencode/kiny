// driver
export { initialState, advance, step, choose, chooseStep, submitInput, submitInputStep } from './driver/storyDriver'
export type { PlayState, LogEntry, InputView, AdvanceResult } from './driver/storyDriver'
export { replay, replayToStory } from './driver/replay'
export type { ReplayResult, ReplayToStoryResult, InteractionStep } from './driver/replay'
// host
export { emptyHost, applyCommand, DEFAULT_TEXT_SPEED, DEFAULT_TEXT_FADE } from './host/commands'
export type { HostState, ResolveAsset, StepMode } from './host/commands'
// components
export { Player } from './components/Player'
export { InputBox } from './components/InputBox'
export type { RevealBinding } from './components/StoryLog'
export type { AwaitKind } from './components/RevealingLine'
// 作品前端资源（css 主题 + 字体）：发现 → 编译成一段 css → 注入
export { discoverAssets, familyOf } from './assets/discover'
export type { DiscoveredAssets } from './assets/discover'
export { buildProjectCss } from './assets/buildCss'
export type { AssetIssue, AssetSources } from './assets/buildCss'
export { rewriteCssUrls, resolveRelative } from './assets/rewrite'
export { ProjectStyles } from './assets/ProjectStyles'
// playback
export { usePlayback } from './playback/usePlayback'
export type { Playback } from './playback/usePlayback'
