import { useEffect, useRef } from 'react'
import type { HostState } from '../host/commands'

/** 把 host.bgm 意图落地到一个循环 <audio>：src 变化时换源，playing 控制 play/pause。 */
export function AudioController({
  bgm, muted,
}: {
  bgm: HostState['bgm']
  muted: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !bgm) return
    el.muted = muted // React 18 不会把 muted prop 同步到 DOM 属性，显式同步
    if (bgm.playing && !muted) {
      el.play().catch(() => { /* autoplay 受限或资源缺失：静默 */ })
    } else {
      el.pause()
    }
  }, [bgm, muted])

  if (!bgm) return null
  return <audio ref={ref} src={bgm.src} loop muted={muted} />
}
