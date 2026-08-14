import { useEffect, useState } from 'react'
import { createStory, type Story, type ValidatedProgram } from '@kiny/engine'
import {
  replayToStory, ProjectStyles,
  type PlayState, type InteractionStep, type ResolveAsset, type CharacterTable,
} from '@kiny/player'
import { loadStory, type LoadedStory } from './load/loadStory'
import { randomSeed } from './load/buildStory'
import { progressKey, loadProgress, saveProgress, clearProgress } from './load/progress'
import { StartGate } from './components/StartGate'
import { PlayingView } from './components/PlayingView'

interface PlayingPhase {
  kind: 'playing'
  story: Story
  resolveAsset: ResolveAsset
  /** 作品前端资源编译出的 css，随首屏门与播放全程注入（换局 / 重开不重算）。 */
  projectCss: string
  /** 作品角色表，同 projectCss 随播放全程带着（换局 / 重开不重算）。 */
  characters: CharacterTable
  program: ValidatedProgram
  start: string
  progKey: string
  seed: number
  initialState?: PlayState
  initialSeq: InteractionStep[]
  notice: string | null
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; loaded: LoadedStory }
  | PlayingPhase

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
    const { story, assetBase, projectCss, characters, title, version, program, start, seed } = phase.loaded
    const resolveAsset: ResolveAsset = (name) => assetBase + name
    const progKey = progressKey(title, version)

    // 从头开始一局（新 seed，存空序列）：首次进入 / 「重新开始」/ 存档分歧回退共用。
    const fresh = (notice: string | null): PlayingPhase => {
      const s = randomSeed()
      const freshStory = createStory(program, { start, seed: s })
      saveProgress(progKey, s, [])
      return { kind: 'playing', story: freshStory, resolveAsset, projectCss, characters, program, start, progKey, seed: s, initialSeq: [], notice }
    }

    // 点击进入播放：有存档则保位重放恢复到上次暂停点；重放分歧（appliedCount < seq）则丢存档从头 + 提示。
    const onStart = () => {
      const saved = loadProgress(progKey)
      if (saved === null) {
        saveProgress(progKey, seed, []) // 首次：沿用 loaded 的 story + seed
        setPhase({ kind: 'playing', story, resolveAsset, projectCss, characters, program, start, progKey, seed, initialSeq: [], notice: null })
        return
      }
      const r = replayToStory(program, start, saved.seed, saved.seq, resolveAsset)
      if (r.appliedCount < saved.seq.length) {
        clearProgress(progKey)
        setPhase(fresh('存档与当前故事不一致，已从头开始。'))
        return
      }
      setPhase({
        kind: 'playing', story: r.story, resolveAsset, projectCss, characters, program, start, progKey,
        seed: saved.seed, initialState: r.state, initialSeq: saved.seq, notice: null,
      })
    }
    // 首屏门也注入：作品字体 / 底色在「开始阅读」前就生效，进正文时不闪一次换肤。
    return (
      <>
        <ProjectStyles css={projectCss} />
        <StartGate title={title} onStart={onStart} />
      </>
    )
  }

  // playing —「重新开始」：清旧进度、以新 seed 从头开一局（复用当前 program/start）。
  const onRestart = () => setPhase(freshFrom(phase))
  return (
    <>
      <ProjectStyles css={phase.projectCss} />
      {phase.notice && <div className="app-notice" role="status">{phase.notice}</div>}
      <PlayingView
        story={phase.story} resolveAsset={phase.resolveAsset}
        initialState={phase.initialState} initialSeq={phase.initialSeq}
        progressKey={phase.progKey} seed={phase.seed} onRestart={onRestart}
        characters={phase.characters}
      />
    </>
  )

  // 「重新开始」：清存档、以新 seed 从头开一局（复用当前 program/start）。
  function freshFrom(p: PlayingPhase): PlayingPhase {
    const s = randomSeed()
    const story = createStory(p.program, { start: p.start, seed: s })
    saveProgress(p.progKey, s, [])
    return { kind: 'playing', story, resolveAsset: p.resolveAsset, projectCss: p.projectCss, characters: p.characters, program: p.program, start: p.start, progKey: p.progKey, seed: s, initialSeq: [], notice: null }
  }
}
