/** AI 侧栏面板（右侧停靠，spec §3.4 / mockup board 1·2）。纯 props 驱动呈现。 */
import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { AiTurn, AiSegment } from '../../ai/useAiSession'
import { ColResizer } from '../ColResizer'

/**
 * 安全的 Markdown 组件覆写：链接渲染成不可导航的高亮文本（防 webview 被劫持到外站）、
 * 图片只显示 alt（不发起远程加载）。react-markdown 默认不渲染原始 HTML，无注入面。
 */
const MD_COMPONENTS: Components = {
  a: ({ children, href }) => <span className="md-link" title={typeof href === 'string' ? href : undefined}>{children}</span>,
  img: ({ alt }) => <span className="md-img">🖼 {alt || '图片'}</span>,
}

/** 按序渲染一轮的片段：思考块 / 叙述段 / 工具卡片（连续工具并进同一卡片）。 */
function renderSegments(segments: AiSegment[]): ReactNode[] {
  const out: ReactNode[] = []
  for (let i = 0; i < segments.length;) {
    const seg = segments[i]
    if (seg.kind === 'tool') {
      const rows: Extract<AiSegment, { kind: 'tool' }>[] = []
      while (i < segments.length && segments[i].kind === 'tool') {
        rows.push(segments[i] as Extract<AiSegment, { kind: 'tool' }>); i++
      }
      out.push(
        <div className="tool-call" key={`tc${i}`}>
          {rows.map((r, j) => (
            <div className="tool-row" key={j}>
              <span className={'tool-ico' + (r.record.ok ? ' ok' : '')}>{r.record.ok ? '✓' : '!'}</span>
              <span className="tool-name">{r.record.call.name}</span>
              <span className={'tool-badge ' + (r.record.ok ? 'ok' : 'err')}>{r.record.ok ? '已执行' : '失败'}</span>
            </div>
          ))}
        </div>,
      )
    } else if (seg.kind === 'think') {
      out.push(<div className="ai-think" key={`th${i}`}><span className="ai-think-tag">思考</span>{seg.text}</div>); i++
    } else {
      out.push(
        <div className="body md" key={`sy${i}`}>
          <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{seg.text}</Markdown>
        </div>,
      ); i++
    }
  }
  return out
}

export interface AiPanelProps {
  configured: boolean
  model: string
  turns: AiTurn[]
  running: boolean
  onSend: (prompt: string) => void
  onStop: () => void
  onNewConversation: () => void
  onClose: () => void
  onOpenSettings: () => void
  /** 拖拽左缘调面板宽度；省略则不渲染分隔条。clientX → 父组件换算列宽。 */
  onResize?: (clientX: number) => void
}

export function AiPanel(props: AiPanelProps) {
  const { configured, model, turns, running, onSend, onStop, onNewConversation, onClose, onOpenSettings, onResize } = props
  const [input, setInput] = useState('')

  const submit = () => {
    const v = input.trim()
    if (!v || running || !configured) return
    onSend(v)
    setInput('')
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  // 运行中状态文案：工具瞬时执行、耗时多在等 LLM，故默认「思考中…」。
  const runningTurn = turns[turns.length - 1]
  const lastSeg = runningTurn?.segments[runningTurn.segments.length - 1]
  const runningText = lastSeg?.kind === 'tool' ? `已执行 ${lastSeg.record.call.name} · 思考中…` : '思考中…'

  return (
    <div className="ai-panel">
      {onResize && <ColResizer edge="left" onResize={onResize} ariaLabel="调整 AI 面板宽度" />}
      <div className="ai-head">
        <span className="title">AI</span>
        <span className="ai-model" style={configured ? undefined : { color: 'var(--text-faint)' }}>
          {configured ? model : '未配置'}
        </span>
        <div className="ai-head-spacer" />
        <button className="ai-iconbtn" title="新对话" aria-label="新对话" disabled={running} onClick={onNewConversation}>＋</button>
        <button className="ai-iconbtn" title="对话历史 · 即将支持" aria-label="对话历史" disabled>⟲</button>
        <button className="ai-iconbtn" title="关闭面板" aria-label="关闭 AI 面板" onClick={onClose}>×</button>
      </div>

      <div className="ai-convo">
        {!configured ? (
          <div className="ai-empty">
            <div className="ai-empty-spark">✦</div>
            <div className="ai-empty-title">让 AI 帮你写故事</div>
            <div className="ai-empty-desc">配置一个你自己的 LLM（OpenAI / DeepSeek / GLM 等），AI 就能建节点、改文本、跑校验——改动都落进可审可撤的编辑缓冲。</div>
            <button className="settings-btn primary" onClick={onOpenSettings}>前往「设置 · AI」</button>
          </div>
        ) : turns.map((t) => (
          <div className="ai-turn" key={t.id}>
            <div className="msg-user">{t.prompt}</div>
            <div className="msg-ai">
              <div className="who"><span className="spark">✦</span>AI</div>
              {renderSegments(t.segments)}
              {t.error && <div className="ai-error"><span className="x">!</span><div><b>{t.error}</b>　详情已记入运行时错误日志。</div></div>}
            </div>
          </div>
        ))}
      </div>

      {running && (
        <div className="ai-running">
          <span className="spinner" />
          <span className="grow">{runningText}</span>
          <button className="ai-stop" onClick={onStop}><span className="sq" />停止</button>
        </div>
      )}

      <div className="ai-input">
        <div className="ai-input-box" style={configured ? undefined : { opacity: 0.5 }}>
          <textarea
            value={input}
            disabled={!configured}
            placeholder={configured ? '让 AI 创作 / 修改你的故事…' : '配置后即可对话…'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ai-input-foot">
            <span className="ai-input-hint">{configured ? '↵ 发送 · ⇧↵ 换行' : '尚未配置 AI'}</span>
            <button className="ai-send" disabled={!configured || running || input.trim() === ''} onClick={submit}>发送 ↵</button>
          </div>
        </div>
      </div>
    </div>
  )
}
