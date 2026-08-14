import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { loadProjectFromFiles, analyze, resolveStart } from '@kiny/engine'
import type { ValidatedProgram } from '@kiny/engine'
import { Player, type PlayState, type ResolveAsset } from '@kiny/player'
import { useState, StrictMode } from 'react'
import { usePreviewPlayback, type PreviewPlayback } from './usePreviewPlayback'

const RESOLVE: ResolveAsset = (name) => 'demo/assets/' + name

function build(kin: string): { program: ValidatedProgram; start: string } {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: 't', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load: ' + res.errors.map((e) => e.message).join(';'))
  const { program } = analyze(res.files)
  if (!program) throw new Error('analyze failed')
  const start = resolveStart(program, res.entry)
  if (start === null) throw new Error('no start')
  return { program, start }
}

function Harness({
  onReady,
  extraOnCommit,
  fastForward = false,
}: {
  onReady: (pb: PreviewPlayback) => void
  extraOnCommit?: (state: PlayState, sfx: string[]) => void
  fastForward?: boolean
}) {
  const [play, setPlay] = useState<PlayState | null>(null)
  const [sfx, setSfx] = useState<string[]>([])
  const pb = usePreviewPlayback((state, s) => {
    setPlay(state)
    setSfx(s)
    extraOnCommit?.(state, s)
  }, fastForward)
  onReady(pb)
  if (!play) return null
  return <Player state={play} onChoose={() => {}} sfx={sfx} reveal={pb.reveal} onContentClick={pb.onContentClick} />
}

const content = (c: HTMLElement) => c.querySelector('.player-content') as HTMLElement

// 分段推进 fake timer：与 player/src/playback/usePlayback.test.tsx 的 pump 同一写法——
// 单次大跨度 advance 跨不过 flow 自动续行时「timer→setState→commit→新 interval」的边界。
function pump(ms = 6000, stepMs = 150) {
  for (let t = 0; t < ms; t += stepMs) act(() => { vi.advanceTimersByTime(stepMs) })
}

describe('usePreviewPlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    window.HTMLMediaElement.prototype.pause = vi.fn()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('restart：从头播，flow 模式打完自动续到暂停点', () => {
    const { program, start } = build('第一行。\n第二行。\n* [继续] -> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    act(() => { pb.restart(program, start, 1, RESOLVE) })
    pump()
    expect(container.textContent).toContain('第一行。')
    expect(container.textContent).toContain('第二行。')
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    expect(pb.active).toBe(false) // 抵达选项，动画收尾
  })

  it('choose：前缀瞬时补齐，只对新追加一步播打字动画', () => {
    const { program, start } = build('开场。\n* [走] -> 后\n=== 后 ===\n后续文字很长用于验证打字机。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    act(() => { pb.choose(program, start, 1, [], 0, RESOLVE) })
    // 前缀「开场。」已经看过，瞬时可见；新追加的一步还在揭示中，未全量出现
    expect(container.textContent).toContain('开场。')
    expect(container.textContent).not.toContain('后续文字很长用于验证打字机。')
    pump()
    expect(container.textContent).toContain('后续文字很长用于验证打字机。')
    expect(container.textContent).toContain('—— 故事结束 ——')
  })

  it('submit：重放到输入暂停点，提交文本后逐行揭示后续正文并写回变量', () => {
    const { program, start } = build('~ let name = "旅人"\n@input(name, "名字")\n你好，这段后续正文足够长用于验证打字机揭示。{name}上路了。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    // 空前缀重放停在 @input 输入框，提交「晓」推进
    act(() => { pb.submit(program, start, 1, [], '晓', RESOLVE) })
    // 提交后的后续正文还在揭示中，未全量出现
    expect(container.textContent).not.toContain('你好，这段后续正文足够长用于验证打字机揭示。晓上路了。')
    pump()
    expect(container.textContent).toContain('你好，这段后续正文足够长用于验证打字机揭示。晓上路了。')
    expect(container.textContent).toContain('—— 故事结束 ——')
  })

  it('submit：重放没停在输入暂停点（脚本变了）时放弃动画、不崩', () => {
    // 该脚本首个暂停点是选项而非输入框；priorSeq=[] 重放停在选项 → submit 应静默放弃
    const { program, start } = build('开场。\n* [走] -> END\n')
    let pb!: PreviewPlayback
    const commits: PlayState[] = []
    render(<Harness onReady={(p) => { pb = p }} extraOnCommit={(s) => commits.push(s)} />)
    act(() => { pb.submit(program, start, 1, [], '晓', RESOLVE) })
    pump()
    expect(commits.length).toBe(0) // 未 run，无任何 commit
    expect(pb.active).toBe(false)
  })

  it('line 模式：点内容区推进到下一行', () => {
    const { program, start } = build('@step_mode("line")\n第一行。\n第二行。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    act(() => { pb.restart(program, start, 1, RESOLVE) })
    pump()
    expect(container.textContent).toContain('第一行。')
    expect(container.textContent).not.toContain('第二行。')
    act(() => { fireEvent.click(content(container)) })
    pump()
    expect(container.textContent).toContain('第二行。')
  })

  it('line 模式等点击时显示推进提示三角，点击推进后消失', () => {
    const { program, start } = build('@step_mode("line")\n第一行。\n第二行。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    act(() => { pb.restart(program, start, 1, RESOLVE) })
    expect(container.querySelector('.advance-indicator')).toBeNull() // 打字中
    pump()
    expect(container.querySelector('.advance-indicator')).not.toBeNull() // 打完等点击
    act(() => { fireEvent.click(content(container)) })
    expect(container.querySelector('.advance-indicator')).toBeNull() // 第二行开始打字
  })

  it('StrictMode 下 choose 仍逐字揭示（回归：双跑 effect 误触 skip → 整段瞬显）', () => {
    const { program, start } = build('开场。\n* [走] -> 后\n=== 后 ===\n后续文字很长用于验证打字机。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(
      <StrictMode>
        <Harness onReady={(p) => { pb = p }} />
      </StrictMode>,
    )
    act(() => { pb.choose(program, start, 1, [], 0, RESOLVE) })
    // editor 生产入口包着 StrictMode：新追加一步必须仍在打字中，不得瞬间全量出现
    expect(container.textContent).not.toContain('后续文字很长用于验证打字机。')
    pump()
    expect(container.textContent).toContain('后续文字很长用于验证打字机。')
  })

  it('@sleep：人工交互的预览真实等待，等满才出下一行', () => {
    const { program, start } = build('@text_speed(0)\n第一行。\n@sleep(1000)\n第二行。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    act(() => { pb.restart(program, start, 1, RESOLVE) })
    pump(200, 50)
    expect(container.textContent).toContain('第一行。')
    expect(container.textContent).not.toContain('第二行。') // 停顿中
    act(() => { fireEvent.click(content(container)) }) // 不可跳过：点击无效
    pump(300, 50)
    expect(container.textContent).not.toContain('第二行。')
    pump(900, 100)
    expect(container.textContent).toContain('第二行。')
  })

  // 快进（T116）：作者调试开关，旁路掉全部演出等待。四条各盯一种等待 + 一条盯不外溢。
  describe('快进', () => {
    it('逐行模式与句中 <pause> 都不再等，一路流到决定点', () => {
      const { program, start } = build('@step_mode("line")\n第一行<pause>还有后半句。\n第二行。\n* [继续] -> END\n')
      let pb!: PreviewPlayback
      const { container } = render(<Harness onReady={(p) => { pb = p }} fastForward />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(300, 50) // 不点任何一下
      expect(container.textContent).toContain('还有后半句。') // 句中点击档没停
      expect(container.textContent).toContain('第二行。') // line 模式没等点击
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    })

    it('毫秒档 <pause=毫秒> 不起定时器，同一帧就出完整行', () => {
      const { program, start } = build('前半<pause=5000>后半。\n* [继续] -> END\n')
      let pb!: PreviewPlayback
      const { container } = render(<Harness onReady={(p) => { pb = p }} fastForward />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(200, 50) // 远小于 5000ms
      expect(container.textContent).toContain('后半。')
    })

    it('@sleep 不等满', () => {
      const { program, start } = build('第一行。\n@sleep(5000)\n第二行。\n-> END\n')
      let pb!: PreviewPlayback
      const { container } = render(<Harness onReady={(p) => { pb = p }} fastForward />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(200, 50)
      expect(container.textContent).toContain('第二行。')
    })

    it('不发音效（旁路等待后音效会挤成一声噪响）', () => {
      const { program, start } = build('@sfx("a.mp3")\n第一行。\n* [继续] -> END\n')
      const sfxSeen: string[][] = []
      let pb!: PreviewPlayback
      render(<Harness onReady={(p) => { pb = p }} extraOnCommit={(_s, sfx) => sfxSeen.push(sfx)} fastForward />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(300, 50)
      expect(sfxSeen.length).toBeGreaterThan(0) // every 对空数组永真——先确认真有 commit 发生
      expect(sfxSeen.every((s) => s.length === 0)).toBe(true)
    })

    // 拨开关那一刻已经在等的两种情况：不放行的话「开关当场无效」，要再点一下才起作用，
    // 而作者点快进最自然的时机恰恰就是盯着不动的画面时。
    it('拨开关时正卡在 @sleep：就地放行，不必等满剩余时长', () => {
      // `@text_speed(0)` 不可省：默认速度下 200ms 内第一行还在打字（含淡入拖尾），
      // 拨开关时压根没停在 sleep 上，这条就退化成「拨开关时正在打字」、测不到它要测的东西。
      const { program, start } = build('@text_speed(0)\n第一行。\n@sleep(9000)\n第二行。\n-> END\n')
      let pb!: PreviewPlayback
      const Wrap = ({ ff }: { ff: boolean }) => <Harness onReady={(p) => { pb = p }} fastForward={ff} />
      const { container, rerender } = render(<Wrap ff={false} />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(200, 50)
      expect(container.textContent).toContain('第一行。') // 已停在 sleep 上（而非仍在打字）
      expect(container.textContent).not.toContain('第二行。')
      act(() => { rerender(<Wrap ff />) }) // ← 此刻拨开快进
      pump(100, 50) // 远小于剩余的 8800ms
      expect(container.textContent).toContain('第二行。')
    })

    it('拨开关时正停在行尾等点击（line 模式）：自动流起来，不必再点一下', () => {
      const { program, start } = build('@step_mode("line")\n@text_speed(0)\n第一行。\n第二行。\n* [继续] -> END\n')
      let pb!: PreviewPlayback
      const Wrap = ({ ff }: { ff: boolean }) => <Harness onReady={(p) => { pb = p }} fastForward={ff} />
      const { container, rerender } = render(<Wrap ff={false} />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(300, 50)
      expect(container.textContent).not.toContain('第二行。') // 等点击
      act(() => { rerender(<Wrap ff />) }) // ← 此刻拨开快进
      pump(300, 50)
      expect(container.textContent).toContain('第二行。')
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    })

    it('关掉快进后一切照旧：line 模式仍等点击', () => {
      const { program, start } = build('@step_mode("line")\n@text_speed(0)\n第一行。\n第二行。\n-> END\n')
      let pb!: PreviewPlayback
      const { container } = render(<Harness onReady={(p) => { pb = p }} />)
      act(() => { pb.restart(program, start, 1, RESOLVE) })
      pump(300, 50)
      expect(container.textContent).toContain('第一行。')
      expect(container.textContent).not.toContain('第二行。')
    })
  })

  it('@sleep：cancel（编辑触发重算）作废在飞停顿，不再续步', () => {
    const { program, start } = build('@text_speed(0)\n第一行。\n@sleep(1000)\n第二行。\n-> END\n')
    let pb!: PreviewPlayback
    const { container } = render(<Harness onReady={(p) => { pb = p }} />)
    act(() => { pb.restart(program, start, 1, RESOLVE) })
    pump(200, 50)
    act(() => { pb.cancel() })
    pump(2000, 100)
    expect(container.textContent).not.toContain('第二行。')
  })

  it('cancel：立即中止在飞动画，之后不再有新的提交', () => {
    const { program, start } = build('第一行。\n第二行。\n* [继续] -> END\n')
    const commits: PlayState[] = []
    let pb!: PreviewPlayback
    render(<Harness onReady={(p) => { pb = p }} extraOnCommit={(s) => commits.push(s)} />)
    act(() => { pb.restart(program, start, 1, RESOLVE) })
    const countAtCancel = commits.length
    act(() => { pb.cancel() })
    pump()
    expect(commits.length).toBe(countAtCancel)
    expect(pb.active).toBe(false)
  })
})
