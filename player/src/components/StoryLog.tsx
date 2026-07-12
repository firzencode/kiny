import { useEffect, useRef } from 'react'
import type { LogEntry } from '../driver/storyDriver'
import { RichText } from './RichText'
import { RevealingLine } from './RevealingLine'

/** 打字机揭示绑定：给 StoryLog 的**最新一行**逐字揭示 + 淡入；不传则全部静态呈现。 */
export interface RevealBinding {
  /** 出字速度（字 / 秒，@text_speed）；0 = 瞬显。 */
  speed: number
  /** 每字淡入时长（ms，@text_fade）。 */
  fade: number
  /** 递增以立即整行显示（点击跳过打字）。 */
  skipToken?: number
  /** 最新一行揭示完成时触发一次。 */
  onLatestRevealed?: () => void
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
          <p key={i} className="narration">
            {reveal && i === latestNarration ? (
              <RevealingLine
                spans={e.spans}
                speed={reveal.speed}
                fade={reveal.fade}
                skipToken={reveal.skipToken}
                onComplete={reveal.onLatestRevealed}
              />
            ) : (
              <RichText spans={e.spans} />
            )}
          </p>
        ) : (
          <p key={i} className="story-end">—— 故事结束 ——</p>
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}
