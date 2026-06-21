import { useEffect, useState } from 'react'
import type { Story } from '@kiny/engine'
import { advance, initialState, type PlayState, type ResolveAsset } from '@kiny/player'
import { loadDemo, type LoadedStory } from './load/loadDemo'
import { StartGate } from './components/StartGate'
import { PlayingView } from './components/PlayingView'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; loaded: LoadedStory }
  | { kind: 'playing'; story: Story; resolveAsset: ResolveAsset; first: PlayState }

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    loadDemo().then((out) => {
      if (!alive) return
      setPhase(out.ok ? { kind: 'ready', loaded: out.value } : { kind: 'error', message: out.message })
    })
    return () => { alive = false }
  }, [])

  if (phase.kind === 'loading') return <div className="app-status">加载中……</div>
  if (phase.kind === 'error') return <div className="app-status app-error">{phase.message}</div>

  if (phase.kind === 'ready') {
    const { story, assetBase, title } = phase.loaded
    const resolveAsset: ResolveAsset = (name) => assetBase + name
    // 在点击手势内一次性推进到首个暂停点（避免 StrictMode 下 advance 被双调用）
    const onStart = () =>
      setPhase({ kind: 'playing', story, resolveAsset, first: advance(story, initialState, resolveAsset).state })
    return <StartGate title={title} onStart={onStart} />
  }

  return <PlayingView story={phase.story} resolveAsset={phase.resolveAsset} first={phase.first} />
}
