import { useState } from 'react'
import type { MediaKind } from '../files/media'

/** 秒 → `m:ss`；非有限值（流式 / 损坏）返回 null，调用方据此不显示时长。 */
function formatDuration(sec: number): string | null {
  if (!Number.isFinite(sec) || sec < 0) return null
  const total = Math.round(sec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * 媒体查看器：图片看图、音频试听。作者导入素材后要能在 editor 内确认「是哪张 / 什么声」。
 *
 * 哑组件——只吃 `{ path, url, kind }`，不碰 gateway / store，故可单测。切换文件由调用方
 * 以 `key={path}` 重挂（缩放模式与元数据随之重置）。
 */
export function MediaView({ path, url, kind }: { path: string; url: string; kind: MediaKind }) {
  // 'contain' = 适应窗口（小图不放大）；'actual' = 原始像素，超出则容器滚动。
  const [fit, setFit] = useState<'contain' | 'actual'>('contain')
  const [failed, setFailed] = useState(false)
  const [meta, setMeta] = useState<string | null>(null)

  return (
    <div className="media-view" data-testid="media-view">
      {kind === 'image' && !failed && (
        <div className="media-bar">
          <button
            type="button"
            className="media-fit-btn"
            aria-label={fit === 'contain' ? '按原始尺寸显示（1:1）' : '缩放至适应窗口'}
            onClick={() => setFit((f) => (f === 'contain' ? 'actual' : 'contain'))}
          >
            {fit === 'contain' ? '1:1' : '适应窗口'}
          </button>
        </div>
      )}
      <div className={'media-stage' + (kind === 'image' && fit === 'actual' ? ' scrollable' : '')}>
        {failed ? (
          // 文件在打开期间被外部删除 / 改名，或格式损坏。给话，不留空白。
          <p className="media-failed">无法加载此资源</p>
        ) : kind === 'image' ? (
          <img
            className={'media-img fit-' + fit}
            src={url}
            alt={path}
            onLoad={(e) => {
              const img = e.currentTarget
              setMeta(`${img.naturalWidth} × ${img.naturalHeight}`)
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <audio
            className="media-audio"
            data-testid="media-audio"
            src={url}
            controls
            onLoadedMetadata={(e) => setMeta(formatDuration(e.currentTarget.duration))}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="media-status" data-testid="media-status">
        <span className="media-status-path">{path}</span>
        {meta !== null && <span className="media-status-meta">{meta}</span>}
      </div>
    </div>
  )
}
