import { useEffect, useState } from 'react'
import type { Story } from '@kiny/engine'
import { type ResolveAsset } from '@kiny/player'
import { loadStory, type LoadedStory } from './load/loadStory'
import { StartGate } from './components/StartGate'
import { PlayingView } from './components/PlayingView'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; loaded: LoadedStory }
  | { kind: 'playing'; story: Story; resolveAsset: ResolveAsset }

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    loadStory().then((out) => {
      if (!alive) return
      if (out.ok) document.title = out.value.title // 导出网页 / demo 标签页标题取故事名
      setPhase(out.ok ? { kind: 'ready', loaded: out.value } : { kind: 'error', message: out.message })
    }).catch((e: unknown) => {
      // 加载链路的未预期抛错（loadStory 正常路径返回 ok:false，这里是最后防线）——
      // 不兜住会永久卡在「加载中……」且读者拿不到任何诊断。
      if (!alive) return
      setPhase({ kind: 'error', message: `加载出错：${e instanceof Error ? e.message : String(e)}` })
    })
    return () => { alive = false }
  }, [])

  if (phase.kind === 'loading') return <div className="app-status">加载中……</div>
  if (phase.kind === 'error') return <div className="app-status app-error">{phase.message}</div>

  if (phase.kind === 'ready') {
    const { story, assetBase, title } = phase.loaded
    const resolveAsset: ResolveAsset = (name) => assetBase + name
    // 点击进入播放；首帧推进 + 逐行揭示由 usePlayback 持有（StrictMode 双调用其内部守卫处理）
    const onStart = () => setPhase({ kind: 'playing', story, resolveAsset })
    return <StartGate title={title} onStart={onStart} />
  }

  return <PlayingView story={phase.story} resolveAsset={phase.resolveAsset} />
}
