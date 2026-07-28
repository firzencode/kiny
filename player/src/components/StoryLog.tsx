import { useEffect, useMemo, useRef } from 'react'
import type { RichSpan } from '@kiny/engine'
import type { LogEntry } from '../driver/storyDriver'
import { RichText } from './RichText'
import { RevealingLine } from './RevealingLine'
import { liftLineClasses, spanClassName } from './spanClasses'

/** 打字机揭示绑定：给 StoryLog 的**最新一行**逐字揭示 + 淡入；不传则全部静态呈现。 */
export interface RevealBinding {
  /** 出字速度（字 / 秒，@text_speed）；0 = 瞬显。 */
  speed: number
  /** 每字淡入时长（ms，@text_fade）。 */
  fade: number
  /** 递增以立即整行显示（点击跳过打字）。 */
  skipToken?: number
  /** 最新一行揭示完成时触发一次（**整行**完成；句中 `<pause>` 停顿不触发）。 */
  onLatestRevealed?: () => void
  /** 最新一行正停在句中 `<pause>` 标记处 / 已续段——宿主据此亮灭推进提示三角。 */
  onAwaitingPause?: (waiting: boolean) => void
  /** line 模式已显示完、等读者点击出下一行——Player 据此显示底部推进提示三角。 */
  awaitingClick?: boolean
}

/** 叙事流：逐条渲染 LogEntry，新内容进来自动滚到底。传 reveal 时最新一行走打字机揭示。 */
export function StoryLog({ entries, reveal }: { entries: LogEntry[]; reveal?: RevealBinding }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  // 最新一条 narration 的下标（其后可能跟 end 标记）；仅它走打字机揭示。
  let latestNarration = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.kind === 'narration') {
      latestNarration = i
      break
    }
  }

  return (
    <div className="story-log">
      {entries.map((e, i) =>
        e.kind === 'narration' ? (
          <NarrationLine
            key={i}
            spans={e.spans}
            reveal={reveal && i === latestNarration ? reveal : undefined}
          />
        ) : (
          <p key={i} className="story-end">—— 故事结束 ——</p>
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}

/**
 * 一行叙事。覆盖整行的作品 class（`<class=letter>` 包住全行）提升到 `.narration` 段落上，
 * 让作者的块级样式（背景 / 边框 / 内边距）作用于整行；只包片段的 class 留在 span 上。
 * 传 reveal 时该行走打字机揭示（揭示态与定格态用同一份剥离后的 spans，class 归属不闪变）。
 */
function NarrationLine({ spans, reveal }: { spans: RichSpan[]; reveal?: RevealBinding }) {
  const { lineClasses, spans: body } = useMemo(() => liftLineClasses(spans), [spans])
  const cls = spanClassName(lineClasses)
  return (
    <p className={cls ? `narration ${cls}` : 'narration'}>
      {reveal ? (
        <RevealingLine
          spans={body}
          speed={reveal.speed}
          fade={reveal.fade}
          skipToken={reveal.skipToken}
          onComplete={reveal.onLatestRevealed}
          onAwaitingPause={reveal.onAwaitingPause}
        />
      ) : (
        <RichText spans={body} />
      )}
    </p>
  )
}
