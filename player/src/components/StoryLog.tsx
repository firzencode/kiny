import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RichSpan } from '@kiny/engine'
import type { LogEntry } from '../driver/storyDriver'
import { RichText } from './RichText'
import { RevealingLine, type AwaitKind } from './RevealingLine'
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
  /**
   * 最新一行正停在句中 `<pause>` 标记处的档位 / 已续段（null）。宿主据此做点击门控：
   * 两档都拦下点击，`'click'` 转为续段并亮推进提示三角，`'timed'` 拦下后丢弃、三角不亮。
   */
  onAwaitingPause?: (waiting: AwaitKind) => void
  /** line 模式已显示完、等读者点击出下一行——Player 据此显示底部推进提示三角。 */
  awaitingClick?: boolean
  /**
   * 宿主要求这一行**立即完成、不做任何等待**：整行瞬显，句中 `<pause>` 两档一并跳过。
   * 目前只有 editor 预览的「快进」调试开关会传（读者端不传，行为一行不变）。
   *
   * 与 `speed: 0` 是两回事，别合并：`speed: 0` 是**作者**用 `@text_speed(0)` 表达的作品设定，
   * 停顿照留（那是叙事节奏，不是动效）；本字段是**宿主**表达的调试意图，停顿一并跳过。
   */
  instant?: boolean
}

/** 叙事流：逐条渲染 LogEntry，新内容进来自动滚到底。传 reveal 时最新一行走打字机揭示。 */
export function StoryLog({ entries, reveal }: { entries: LogEntry[]; reveal?: RevealBinding }) {
  const endRef = useRef<HTMLDivElement>(null)
  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  useEffect(() => {
    scrollToEnd()
  }, [entries.length, scrollToEnd])

  // 最新一条**内容**（narration / image / divider）的下标（其后可能跟 end 标记）。
  // narration 走打字机揭示；image 与 divider 无揭示过程，但仍须占住这个位置——否则它上面那条
  // narration 会被误当成「最新」而重播一遍打字机。
  let latestContent = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    const k = entries[i]!.kind
    if (k === 'narration' || k === 'image' || k === 'divider') {
      latestContent = i
      break
    }
  }
  const latest = latestContent >= 0 ? entries[latestContent]! : null
  // 无揭示过程的内容行（插图 / 分割线）：两者对宿主推进的语义完全一致，合并成一个上报源。
  const latestInstant = latest !== null && (latest.kind === 'image' || latest.kind === 'divider') ? latest : null

  // 最新条目是插图 / 分割线 → 立即上报一次「揭示完成」（视作零时长揭示）。**必需**：宿主在 commit
  // 时置 revealingRef=true，此后的推进全靠该回调解锁；它们不挂 RevealingLine 就没有回调来源，
  // flow 模式会永久卡死、line 模式的推进提示三角永不亮。走这条路则两套逻辑全部复用、宿主一行不改。
  //
  // 判重按 **entry 对象身份**，不能按下标：`@clear` 把 log 清空发生在**同一次 step 内**，
  // 故「清屏后紧跟一张插图」渲染出的两次都是下标 0，按下标判重会漏报第二张 → 永久死锁。
  // reduceEvent 每次执行 `@img` / `@divider` 都新造对象，身份天然唯一。
  const onLatestRevealed = reveal?.onLatestRevealed
  const reportedRef = useRef<LogEntry | null>(null)
  useEffect(() => {
    // 无 cleanup + ref 判重：StrictMode 的 create→destroy→create 双跑也只上报一次
    // （两次报 = flow 多走一步 = 下一行的打字机被静默跳过）。
    // 没有 reveal 绑定时**不消耗**判重槽：否则「先无绑定渲染、后挂上绑定」会被当成已报过，
    // 宿主再也等不到这一条的揭示完成——正是本判重要防的那类死锁。
    if (latestInstant !== null && onLatestRevealed !== undefined && reportedRef.current !== latestInstant) {
      reportedRef.current = latestInstant
      onLatestRevealed()
    }
  }, [latestInstant, onLatestRevealed])

  return (
    <div className="story-log">
      {entries.map((e, i) =>
        e.kind === 'narration' ? (
          <NarrationLine
            key={i}
            spans={e.spans}
            reveal={reveal && i === latestContent ? reveal : undefined}
          />
        ) : e.kind === 'image' ? (
          <Illustration key={i} entry={e} onLoad={scrollToEnd} />
        ) : e.kind === 'divider' ? (
          <Divider key={i} entry={e} />
        ) : (
          <p key={i} className="story-end">—— 故事结束 ——</p>
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}

/**
 * 正文插图。基线 class `kin-illustration` 恒在（作品 css 的统一挂载点），作者类名只作追加覆盖。
 * 加载失败降级交给原生 `alt` 行为（浏览器自行显示替代文字），不监听 onerror、不做占位框。
 * `onLoad` 补一次滚到底：图片渲染时高度为 0、加载完成才撑开，不补滚会把正文顶出视野。
 */
function Illustration({ entry, onLoad }: { entry: Extract<LogEntry, { kind: 'image' }>; onLoad: () => void }) {
  const cls = entry.cls ? `kin-illustration ${spanClassName([entry.cls])}` : 'kin-illustration'
  return <img className={cls} src={entry.src} alt={entry.alt ?? ''} onLoad={onLoad} />
}

/**
 * 正文分割线。用真 `<hr>`（原生 separator 语义），作为 story-log 的**直接子元素**——块级元素
 * 套进 `<p class="narration">` 是无效 HTML 嵌套，这正是分割线走命令而非行内标签的原因。
 * 基线 class `kin-divider` 恒在（作品 css 的统一挂载点），作者类名只作追加覆盖，同 `kin-illustration`。
 */
function Divider({ entry }: { entry: Extract<LogEntry, { kind: 'divider' }> }) {
  const cls = entry.cls ? `kin-divider ${spanClassName([entry.cls])}` : 'kin-divider'
  return <hr className={cls} />
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
          instant={reveal.instant}
          onComplete={reveal.onLatestRevealed}
          onAwaitingPause={reveal.onAwaitingPause}
        />
      ) : (
        <RichText spans={body} />
      )}
    </p>
  )
}
