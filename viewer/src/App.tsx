import { useEffect, useState } from 'react'
import { createStory, type Story, type ValidatedProgram } from '@kiny/engine'
import {
  replayToStory, ProjectStyles,
  type PlayState, type InteractionStep, type ResolveAsset, type CharacterTable,
} from '@kiny/player'
import { loadStory, type LoadedStory } from './load/loadStory'
import { randomSeed } from './load/buildStory'
import {
  AUTO_SAVE_ID, savesKey, listSaves, writeSave, migrateLegacy, migrateByTitle, type ViewerSave,
} from './load/saves'
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
  saveKey: string
  /** 故事名（顶栏展示）。 */
  title: string
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
    const { story, assetBase, projectCss, characters, title, version, id, program, start, seed } = phase.loaded
    const resolveAsset: ResolveAsset = (name) => assetBase + name
    const key = savesKey(id, title)
    // 顺序：先名→id 复制（作者补上 id 重新导出后接住读者的旧进度），再走 kiny-progress 那条更老的链。
    // 后者以「当前键已有存档则不覆盖」为幂等条件，故新链的结果优先、老链只在两者都空时才生效。
    migrateByTitle(key, title)
    migrateLegacy(key, title, version) // 旧键（kiny-progress:名@版本）一次性转成 auto 档

    // 从头开始一局（新 seed）：首次进入 /「重新开始」/ 存档分歧回退共用。
    const fresh = (notice: string | null): PlayingPhase => {
      const s = randomSeed()
      const freshStory = createStory(program, { start, seed: s })
      writeSave(key, { id: AUTO_SAVE_ID, kind: 'auto', seed: s, seq: [], meta: { timestamp: Date.now(), label: '开始' } })
      return { kind: 'playing', story: freshStory, resolveAsset, projectCss, characters, program, start, saveKey: key, title, seed: s, initialSeq: [], notice }
    }

    // 点击进入播放：有 auto 档则保位重放恢复到上次暂停点；重放分歧则从头 + 提示。
    const onStart = () => {
      const auto = listSaves(key).find((s) => s.id === AUTO_SAVE_ID)
      if (auto === undefined) {
        // 无条件落一条空 auto 档：即便读者已有别的手动档，这里也要写——它钉住的是本次
        // run 的 seed（loadStory 的默认 seed 每次刷新都随机取，见 loadStory.ts），不钉住
        // 读者若在首次交互前刷新就会换到另一颗种子。「重新开始」的 fresh/freshFrom 走的
        // 是同一条无条件写规则，两条路径必须一致，否则同一问题两个答案。
        writeSave(key, { id: AUTO_SAVE_ID, kind: 'auto', seed, seq: [], meta: { timestamp: Date.now(), label: '开始' } })
        setPhase({ kind: 'playing', story, resolveAsset, projectCss, characters, program, start, saveKey: key, title, seed, initialSeq: [], notice: null })
        return
      }
      const r = replayToStory(program, start, auto.seed, auto.seq, resolveAsset)
      if (r.appliedCount < auto.seq.length) {
        setPhase(fresh('存档与当前故事不一致，已从头开始。'))
        return
      }
      setPhase({
        kind: 'playing', story: r.story, resolveAsset, projectCss, characters, program, start, saveKey: key, title,
        seed: auto.seed, initialState: r.state, initialSeq: auto.seq, notice: null,
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

  // playing —「重新开始」：以新 seed 从头开一局（复用当前 program/start）。
  const onRestart = () => setPhase(freshFrom(phase))

  /** 读档：重放该条存档；分歧则返回失败文案交面板展示（存档不删）。 */
  const onLoadSave = (save: ViewerSave): string | null => {
    const p = phase as PlayingPhase
    const r = replayToStory(p.program, p.start, save.seed, save.seq, p.resolveAsset)
    if (r.appliedCount < save.seq.length) return '该存档对应的故事已更新，无法读取此存档。'
    setPhase({ ...p, story: r.story, seed: save.seed, initialState: r.state, initialSeq: save.seq, notice: null })
    return null
  }

  return (
    <>
      <ProjectStyles css={phase.projectCss} />
      {phase.notice && <div className="app-notice" role="status">{phase.notice}</div>}
      <PlayingView
        story={phase.story} resolveAsset={phase.resolveAsset}
        initialState={phase.initialState} initialSeq={phase.initialSeq}
        saveKey={phase.saveKey} seed={phase.seed} title={phase.title}
        onRestart={onRestart} onLoadSave={onLoadSave}
        characters={phase.characters}
      />
    </>
  )

  // 「重新开始」：以新 seed 从头开一局（复用当前 program/start）。
  function freshFrom(p: PlayingPhase): PlayingPhase {
    const s = randomSeed()
    const story = createStory(p.program, { start: p.start, seed: s })
    writeSave(p.saveKey, { id: AUTO_SAVE_ID, kind: 'auto', seed: s, seq: [], meta: { timestamp: Date.now(), label: '开始' } })
    return { ...p, story, seed: s, initialState: undefined, initialSeq: [], notice: null }
  }
}
