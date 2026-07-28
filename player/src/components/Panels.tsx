import type { HostState } from '../host/commands'
import { RichText } from './RichText'

/**
 * 固定区域（`@panel`）：四个槽各一个容器，空槽（未登记 / 已清空）不渲染。
 * 内容用 RichText 呈现（富文本 / 字体 / class 全可用），**无打字机揭示**——整体改写、即时呈现。
 * `aria-live="polite"` 让屏幕阅读器在内容变化时播报。默认无装饰（如普通文字），外观走
 * `--kiny-panel-*` token + 项目 css 自定义。
 * `left` / `right` / `bottom` 是相对 `.player` 定位的浮层（只落在阅读 / 预览区内），
 * `after` 由 StoryLog 内联在正文末（见 Player）。
 */
export function FixedPanels({ panels }: { panels: HostState['panels'] }) {
  return (
    <>
      {panels.left && (
        <aside className="panel panel-left" aria-live="polite">
          <RichText spans={panels.left} />
        </aside>
      )}
      {panels.right && (
        <aside className="panel panel-right" aria-live="polite">
          <RichText spans={panels.right} />
        </aside>
      )}
      {panels.bottom && (
        <div className="panel panel-bottom" aria-live="polite">
          <RichText spans={panels.bottom} />
        </div>
      )}
    </>
  )
}

/** 正文后固定栏（`after` 槽）：随正文流滚动、排在选项 / 输入框之前，故单独由 Player 内联。 */
export function AfterPanel({ panels }: { panels: HostState['panels'] }) {
  if (!panels.after) return null
  return (
    <div className="panel panel-after" aria-live="polite">
      <RichText spans={panels.after} />
    </div>
  )
}
