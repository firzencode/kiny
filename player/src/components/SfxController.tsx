import { useEffect, useRef } from 'react'

/**
 * 把瞬时 sfx 队列落地为一次性 <audio> 播放：队列引用变化时逐个 new Audio().play()。
 * muted 抑制（错过不补播）；用 ref 读 muted 避免静音切换重跑 effect 误补播。
 * play 失败静默（autoplay 受限 / 资源缺失），与 AudioController 一致。
 */
export function SfxController({ sfx, muted }: { sfx: string[]; muted: boolean }) {
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  useEffect(() => {
    if (mutedRef.current) return
    for (const url of sfx) {
      new Audio(url).play().catch(() => { /* autoplay 受限 / 资源缺失：静默 */ })
    }
  }, [sfx])
  return null
}
