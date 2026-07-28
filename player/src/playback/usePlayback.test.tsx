import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { loadProjectFromFiles, analyze, resolveStart, createStory, plainText } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { usePlayback } from './usePlayback'
import { Player } from '../components/Player'
import { initialState, advance, type PlayState } from '../driver/storyDriver'
import type { ResolveAsset } from '../host/commands'

const RESOLVE: ResolveAsset = (name) => 'demo/assets/' + name

function makeStory(kin: string): Story {
  const res = loadProjectFromFiles(
    JSON.stringify({ name: 't', version: '1.0.0', engine: '0.1.0', entry: 'main.kin' }),
    new Map([['main.kin', kin]]),
  )
  if (!res.ok) throw new Error('load: ' + res.errors.map((e) => e.message).join(';'))
  const { program } = analyze(res.files)
  if (!program) throw new Error('analyze failed')
  const start = resolveStart(program, res.entry)!
  return createStory(program, { start })
}

function Harness({ story }: { story: Story }) {
  const pb = usePlayback(story, RESOLVE)
  return (
    <Player state={pb.state} onChoose={pb.onChoose} onSubmitInput={pb.onSubmitInput} sfx={pb.sfx} reveal={pb.reveal} onContentClick={pb.onContentClick} />
  )
}

/** 从既有播放态续读（reader 的「继续」/ 读档路径）。 */
function HarnessFrom({ story, initial }: { story: Story; initial: PlayState }) {
  const pb = usePlayback(story, RESOLVE, initial)
  return (
    <Player state={pb.state} onChoose={pb.onChoose} onSubmitInput={pb.onSubmitInput} sfx={pb.sfx} reveal={pb.reveal} onContentClick={pb.onContentClick} />
  )
}

const content = (c: HTMLElement) => c.querySelector('.player-content') as HTMLElement

// 分段推进 fake timer：每段 act 让 React commit 新行的 RevealingLine effect（排下一个 interval），
// 下一段再处理它——单次大跨度 advance 无法跨越 flow 自动续行时「timer→setState→commit→新 interval」的边界。
function pump(ms = 6000, stepMs = 150) {
  for (let t = 0; t < ms; t += stepMs) act(() => { vi.advanceTimersByTime(stepMs) })
}

describe('usePlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    window.HTMLMediaElement.prototype.pause = vi.fn()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('flow 模式：逐行打字机自动续，最终抵选项', () => {
    const { container } = render(<Harness story={makeStory('第一行。\n第二行。\n* [继续] -> END\n')} />)
    pump()
    expect(container.textContent).toContain('第一行。')
    expect(container.textContent).toContain('第二行。')
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
  })

  it('line 模式：一行打完不自动续，点击才出下一行', () => {
    const { container } = render(<Harness story={makeStory('@step_mode("line")\n第一行。\n第二行。\n-> END\n')} />)
    pump()
    // 逐行模式：第一行显示后停住，第二行未出
    expect(container.textContent).toContain('第一行。')
    expect(container.textContent).not.toContain('第二行。')
    // 点正文区 → 推进到第二行
    act(() => { fireEvent.click(content(container)) })
    pump()
    expect(container.textContent).toContain('第二行。')
  })

  it('line 模式等点击时显示推进提示三角；打字中 / flow 模式 / 抵暂停点不显示', () => {
    const { container } = render(<Harness story={makeStory('@step_mode("line")\n第一行。\n第二行。\n-> END\n')} />)
    expect(container.querySelector('.advance-indicator')).toBeNull() // 打字中
    pump()
    expect(container.querySelector('.advance-indicator')).not.toBeNull() // 打完等点击
    act(() => { fireEvent.click(content(container)) })
    expect(container.querySelector('.advance-indicator')).toBeNull() // 下一行开始打字
    pump()
    // 第二行打完后点击 → 抵结束暂停点，不再等点击
    act(() => { fireEvent.click(content(container)) })
    pump()
    expect(container.textContent).toContain('—— 故事结束 ——')
    expect(container.querySelector('.advance-indicator')).toBeNull()
  })

  it('flow 模式全程不显示推进提示三角', () => {
    const { container } = render(<Harness story={makeStory('第一行。\n* [继续] -> END\n')} />)
    pump()
    expect(container.textContent).toContain('第一行。')
    expect(container.querySelector('.advance-indicator')).toBeNull()
  })

  it('打字中点击 → 立即整行显示（跳过打字）', () => {
    const { container } = render(<Harness story={makeStory('@step_mode("line")\n@text_speed(20)\n很长的一行文字内容。\n-> END\n')} />)
    act(() => { vi.advanceTimersByTime(30) }) // 只揭示了几个字
    const partial = content(container).textContent ?? ''
    expect(partial).not.toContain('很长的一行文字内容。')
    act(() => { fireEvent.click(content(container)) }) // 打字中点击 → 跳过
    expect(container.textContent).toContain('很长的一行文字内容。')
  })

  describe('@sleep 演出停顿', () => {
    const SLEEP_KIN = '@text_speed(0)\n第一行。\n@sleep(1000)\n第二行。\n-> END\n'

    it('等满时长才出下一行；不到点不出', () => {
      const { container } = render(<Harness story={makeStory(SLEEP_KIN)} />)
      pump(200, 50)
      expect(container.textContent).toContain('第一行。')
      expect(container.textContent).not.toContain('第二行。') // 停顿中
      pump(1200, 100)
      expect(container.textContent).toContain('第二行。')
    })

    it('停顿不可跳过：等待期间点击既不提前续行、也不误触发 line 模式下一行', () => {
      const { container } = render(<Harness story={makeStory(`@step_mode("line")\n${SLEEP_KIN}`)} />)
      pump(200, 50)
      expect(container.textContent).not.toContain('第二行。')
      act(() => { fireEvent.click(content(container)) })
      act(() => { fireEvent.click(content(container)) })
      pump(300, 50) // 仍未到 1000ms
      expect(container.textContent).not.toContain('第二行。') // 点击无效，停顿照走
      pump(900, 100)
      expect(container.textContent).toContain('第二行。')
    })

    it('停顿期间不亮推进提示三角（不是「等读者」态）', () => {
      const { container } = render(<Harness story={makeStory(`@step_mode("line")\n${SLEEP_KIN}`)} />)
      pump(300, 50)
      expect(container.querySelector('.advance-indicator')).not.toBeNull() // 第一行打完：等读者点击
      act(() => { fireEvent.click(content(container)) }) // 点击 → 撞上 sleep，进入停顿
      expect(container.querySelector('.advance-indicator')).toBeNull() // 停顿中：不是等读者，不亮
      pump(1200, 100)
      expect(container.textContent).toContain('第二行。')
    })

    it('选项前的 sleep：等满后选项才浮现', () => {
      const { container } = render(<Harness story={makeStory('@text_speed(0)\n开场。\n@sleep(800)\n* [继续] -> END\n')} />)
      pump(200, 50)
      expect(screen.queryByRole('button', { name: '继续' })).toBeNull()
      pump(1000, 100)
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
      expect(container.textContent).toContain('开场。')
    })

    it('换 story（读档 / 重开）清理未决停顿定时器：旧故事的定时器不再多推新故事一步', () => {
      const { container, rerender } = render(<Harness story={makeStory(SLEEP_KIN)} />)
      pump(200, 50)
      // 新故事用 line 模式多行：漏清旧定时器会让它多走一步、把「新第二行」提前放出来。
      rerender(<Harness story={makeStory('@step_mode("line")\n@text_speed(0)\n新一行。\n新二行。\n-> END\n')} />)
      pump(2000, 100)
      expect(container.textContent).toContain('新一行。')
      expect(container.textContent).not.toContain('新二行。') // 未点击 → 不该自己走到第二行
      expect(container.textContent).not.toContain('第二行。') // 旧故事的行也没被续出来
    })

    it('StrictMode：开场第一条就是 @sleep 时停顿照常走完（模拟卸载只清句柄、重挂剩余时长）', () => {
      // 回归：卸载 effect 若把等待意图一并清掉，双跑的 reset effect 会因 ref 守卫早退、
      // 无人重挂定时器 → flow 模式下故事永久卡死（读者点也点不动）。
      // **脚本必须让 sleep 在挂载 effect 的首个 doStep 里就 arm**——若第一条是正文，
      // 停顿要等该行揭示完（双跑之后）才挂上，就绕开了被修的窗口、旧实现同样能过。
      const { container } = render(
        <StrictMode>
          <Harness story={makeStory('@text_speed(0)\n@sleep(1000)\n第一行。\n-> END\n')} />
        </StrictMode>,
      )
      pump(200, 50)
      expect(container.textContent).not.toContain('第一行。') // 停顿中，正文还没出
      pump(1200, 100)
      expect(container.textContent).toContain('第一行。') // 重挂生效，等满后照常续步
    })
  })

  describe('<pause> 句中点击续显', () => {
    const KIN = '@text_speed(0)\n凶手就是…<pause>你自己！\n下一行。\n-> END\n'

    it('flow 模式下标记同样等点击（自动续步只发生在整行揭示完之后）', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump(500, 50)
      expect(container.textContent).toContain('凶手就是…')
      expect(container.textContent).not.toContain('你自己！') // 停在标记，flow 也不自动越过
      expect(container.textContent).not.toContain('下一行。')
      act(() => { fireEvent.click(content(container)) })
      pump(500, 50)
      expect(container.textContent).toContain('你自己！')
      expect(container.textContent).toContain('下一行。') // 整行完成后 flow 才自动续步
    })

    it('停在标记时亮推进提示三角，续段后灭', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump(300, 50)
      expect(container.querySelector('.advance-indicator')).not.toBeNull()
      act(() => { fireEvent.click(content(container)) })
      expect(container.querySelector('.advance-indicator')).toBeNull()
    })

    it('读档续读：最新行含 <pause> 时点击仍能续段（回归：此前点击无效、后半句永久出不来）', () => {
      // 模拟 reader 的「继续」：同一 story 实例已推进到暂停点，存档态作 initial。
      // 此时 usePlayback 的首个 step 直接落回暂停点 → revealingRef 为 false，
      // 但 StoryLog 仍把 reveal 绑在最新一行上，该行照常分段停在标记。
      const kin = '@text_speed(0)\n凶手就是…<pause>你自己！\n* [继续] -> END\n'
      const story = makeStory(kin)
      const saved = advance(story, initialState, RESOLVE).state
      const { container } = render(<HarnessFrom story={story} initial={saved} />)
      pump(200, 50)
      expect(container.textContent).toContain('凶手就是…')
      expect(container.textContent).not.toContain('你自己！')
      act(() => { fireEvent.click(content(container)) })
      expect(container.textContent).toContain('你自己！')
    })

    it('读档 / 重放（advance 无动画路径）整行直显，不停半行', () => {
      // 用 advance 一次排空 = replay / restore 走的路径：log 里是完整行。
      const story = makeStory(KIN)
      const r = advance(story, initialState, RESOLVE)
      const line = r.state.log.find((e) => e.kind === 'narration')
      expect(line && line.kind === 'narration' && plainText(line.spans)).toBe('凶手就是…你自己！')
    })
  })

  it('选项推进后继续逐行揭示', () => {
    const kin = '开场。\n* [走] -> 后\n=== 后 ===\n后续一行。\n-> END\n'
    const { container } = render(<Harness story={makeStory(kin)} />)
    pump()
    act(() => { fireEvent.click(screen.getByRole('button', { name: '走' })) })
    pump()
    expect(container.textContent).toContain('后续一行。')
    expect(container.textContent).toContain('—— 故事结束 ——')
  })

  it('@input：抵输入框暂停（不自动续过），提交后继续揭示所填文本', () => {
    const kin = '~ let player_name = "旅人"\n@input(player_name, "名字")\n你好，{player_name}。\n-> END\n'
    const { container } = render(<Harness story={makeStory(kin)} />)
    pump()
    // 停在输入框：出现输入框、未越过（后续「你好」尚未出现）
    const field = screen.getByPlaceholderText('名字') as HTMLInputElement
    expect(field).toBeInTheDocument()
    expect(container.textContent).not.toContain('你好')
    // 填名字提交 → 后续插值显示所填
    act(() => { fireEvent.change(field, { target: { value: 'Bob' } }) })
    act(() => { fireEvent.submit(field.closest('form')!) })
    pump()
    expect(container.textContent).toContain('你好，Bob。')
    expect(container.textContent).toContain('—— 故事结束 ——')
  })

  it('@input 空提交：保留变量声明的默认值', () => {
    const kin = '~ let player_name = "旅人"\n@input(player_name)\n你好，{player_name}。\n-> END\n'
    const { container } = render(<Harness story={makeStory(kin)} />)
    pump()
    const field = screen.getByRole('textbox') as HTMLInputElement
    act(() => { fireEvent.submit(field.closest('form')!) }) // 空提交
    pump()
    expect(container.textContent).toContain('你好，旅人。')
  })

  it('点选项不冒泡到正文区点击（与 InputBox 的防御一致）', () => {
    const spy = vi.fn()
    const state = { ...initialState, choices: [{ spans: [{ text: '走' }], index: 0 }] }
    render(<Player state={state} onChoose={() => {}} onContentClick={spy} />)
    fireEvent.click(screen.getByRole('button', { name: '走' }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('选项后紧跟 @clear：新行落在与旧行相同的 log 下标，仍逐字打出而非瞬显', () => {
    const kin = '@text_speed(20)\n开场的问题行。\n* [选它] -> 后\n=== 后 ===\n@clear()\n选后很长的一行文字。\n-> END\n'
    const { container } = render(<Harness story={makeStory(kin)} />)
    pump()
    expect(container.textContent).toContain('开场的问题行。')
    act(() => { fireEvent.click(screen.getByRole('button', { name: '选它' })) })
    act(() => { vi.advanceTimersByTime(30) }) // 20 字/秒 → 30ms 至多 1 字
    expect(container.textContent).not.toContain('选后很长的一行文字。') // 打字中，不得整行瞬显
    pump()
    expect(container.textContent).toContain('选后很长的一行文字。')
  })

  it('换 story 后第一行仍逐字打出（skipToken 重置不被误判为跳过）', () => {
    const { container, rerender } = render(<Harness story={makeStory('@text_speed(20)\n很长的第一行文字内容。\n-> END\n')} />)
    act(() => { vi.advanceTimersByTime(30) })
    act(() => { fireEvent.click(content(container)) }) // 打字中点击跳过 → skipToken 递增
    expect(container.textContent).toContain('很长的第一行文字内容。')
    // 换新故事（重开 / 读档路径）：skipToken 重置为 0，首行 log 下标与旧首行重合 → 实例复用
    rerender(<Harness story={makeStory('@text_speed(20)\n新故事的开场长行。\n-> END\n')} />)
    act(() => { vi.advanceTimersByTime(30) })
    expect(container.textContent).not.toContain('新故事的开场长行。') // 应在打字中
    pump()
    expect(container.textContent).toContain('新故事的开场长行。')
  })
})
