import { useEffect, useRef } from 'react'
import type { LogEntry } from '../driver/storyDriver'

/** 叙事流：逐条渲染 LogEntry，新内容进来自动滚到底。 */
export function StoryLog({ entries }: { entries: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div className="story-log">
      {entries.map((e, i) =>
        e.kind === 'narration' ? (
          <p key={i} className="narration">{e.text}</p>
        ) : (
          <p key={i} className="story-end">—— 故事结束 ——</p>
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}
