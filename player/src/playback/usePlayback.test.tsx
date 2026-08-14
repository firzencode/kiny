import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { loadProjectFromFiles, analyze, resolveStart, createStory, plainText } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { usePlayback } from './usePlayback'
import { Player } from '../components/Player'
import type { RevealBinding } from '../components/StoryLog'
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

  // `instant`（跳过分段停顿）是 editor 预览快进开关专用的**宿主**意图。读者端一旦传上，
  // 作者写的句中 `<pause>` 会在 viewer / reader / shelf 里静默失效——把「不传」钉成断言，
  // 而不是只靠注释与类型可选。
  it('读者端不传 instant：分段停顿对读者恒生效', () => {
    let seen: RevealBinding | undefined
    function Probe({ story }: { story: Story }) {
      const pb = usePlayback(story, RESOLVE)
      seen = pb.reveal
      return null
    }
    render(<Probe story={makeStory('第一行。\n* [继续] -> END\n')} />)
    expect(seen).toBeDefined()
    expect(seen?.instant).toBeUndefined()
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

    it('line 模式：续段揭示完整行后，三角仍亮且点击能出下一行（回归：等待态残留吞掉点击）', () => {
      const kin = '@text_speed(0)\n@step_mode("line")\n凶手就是…<pause>你自己！\n下一行。\n-> END\n'
      const { container } = render(<Harness story={makeStory(kin)} />)
      pump(300, 50)
      act(() => { fireEvent.click(content(container)) }) // 续段 → 整行完成
      expect(container.textContent).toContain('你自己！')
      expect(container.querySelector('.advance-indicator')).not.toBeNull() // 整行完等点击，三角亮
      act(() => { fireEvent.click(content(container)) })
      pump(300, 50)
      expect(container.textContent).toContain('下一行。')
    })
  })

  describe('<pause=毫秒> 定时续显', () => {
    const KIN = '@text_speed(0)\n门开了一条缝<pause=2000>，什么都没有。\n下一行。\n-> END\n'

    it('毫秒档等满自动续段，flow 随后自动续行', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump(500, 50)
      expect(container.textContent).toContain('门开了一条缝')
      expect(container.textContent).not.toContain('什么都没有') // 时长未满
      pump(2000, 50)
      expect(container.textContent).toContain('什么都没有')
      expect(container.textContent).toContain('下一行。')
    })

    it('等待期间点击完全无效：不续段、也不越到下一行（同 @sleep）', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump(300, 50)
      act(() => { fireEvent.click(content(container)) })
      act(() => { fireEvent.click(content(container)) })
      expect(container.textContent).not.toContain('什么都没有')
      expect(container.textContent).not.toContain('下一行。') // 没掉进 line/flow 的 doStep
      pump(2500, 50)
      expect(container.textContent).toContain('什么都没有') // 等满照常续
    })

    it('毫秒档等待期间推进提示三角不亮（不是「等你点击」态）', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump(300, 50)
      expect(container.textContent).toContain('门开了一条缝')
      expect(container.querySelector('.advance-indicator')).toBeNull()
    })

    it('line 模式：毫秒档等待中点击不跳行，等满续段后才由点击出下一行', () => {
      const kin = '@text_speed(0)\n@step_mode("line")\n门开了一条缝<pause=2000>，什么都没有。\n下一行。\n-> END\n'
      const { container } = render(<Harness story={makeStory(kin)} />)
      pump(300, 50)
      act(() => { fireEvent.click(content(container)) })
      expect(container.textContent).not.toContain('下一行。') // 点击被拦下、没跳行
      pump(2500, 50)
      expect(container.textContent).toContain('什么都没有')
      expect(container.textContent).not.toContain('下一行。') // line 模式：整行完等点击
      act(() => { fireEvent.click(content(container)) })
      pump(300, 50)
      expect(container.textContent).toContain('下一行。')
    })

    it('读档 / 重放（advance 无动画路径）整行直显、零等待', () => {
      const story = makeStory(KIN)
      const r = advance(story, initialState, RESOLVE)
      const line = r.state.log.find((e) => e.kind === 'narration')
      expect(line && line.kind === 'narration' && plainText(line.spans)).toBe('门开了一条缝，什么都没有。')
    })
  })

  describe('@img 正文插图', () => {
    const KIN = '@text_speed(0)\n她推开门。\n@img("assets/tavern.jpg", "酒馆")\n炉火还没灭。\n* [继续] -> END\n'

    it('flow 模式：插图后自动续到下一行（回归：不上报揭示完成会永久卡死）', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump()
      expect(container.querySelector('img')).not.toBeNull()
      expect(container.textContent).toContain('炉火还没灭。') // 越过插图继续流到选项
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    })

    it('line 模式：插图后停住、三角亮，点击才出下一条', () => {
      const kin = '@text_speed(0)\n@step_mode("line")\n她推开门。\n@img("assets/tavern.jpg")\n炉火还没灭。\n* [继续] -> END\n'
      const { container } = render(<Harness story={makeStory(kin)} />)
      pump(500, 50)
      act(() => { fireEvent.click(content(container)) }) // 出插图
      pump(300, 50)
      expect(container.querySelector('img')).not.toBeNull()
      expect(container.textContent).not.toContain('炉火还没灭。') // 停在插图这条内容上
      expect(container.querySelector('.advance-indicator')).not.toBeNull()
      act(() => { fireEvent.click(content(container)) })
      pump(300, 50)
      expect(container.textContent).toContain('炉火还没灭。')
    })

    it('插图 src 经 resolve 落到 DOM（宿主 URL，不是脚本里的裸路径）', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump()
      expect(container.querySelector('img')!.getAttribute('src')).toBe('demo/assets/assets/tavern.jpg')
    })

    it('@clear 后紧跟插图不卡死（回归：两张图落同一下标、按下标判重会漏报揭示完成）', () => {
      // 章节插页 / CG 回廊这类写法：清屏 → 换一张图 → 继续。@clear 与其后的 @img 在**同一次
      // step 内**归约，渲染上看到的是 [imgA] → [imgB]、下标都是 0。
      const kin = '@text_speed(0)\n@img("a.png")\n@clear()\n@img("b.png")\n后一行。\n* [继续] -> END\n'
      const { container } = render(<Harness story={makeStory(kin)} />)
      pump()
      expect(container.querySelector('img')!.getAttribute('src')).toBe('demo/assets/b.png')
      expect(container.textContent).toContain('后一行。') // flow 没在第二张图上停住
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    })

    it('读档 / 重放（advance 排空路径）插图确定性重现在正文历史里', () => {
      const story = makeStory(KIN)
      const r = advance(story, initialState, RESOLVE)
      expect(r.state.log.filter((e) => e.kind === 'image')).toHaveLength(1)
    })
  })

  describe('@divider 正文分割线', () => {
    const KIN = '@text_speed(0)\n第一幕结束。\n@divider()\n第二幕开始。\n* [继续] -> END\n'

    it('flow 模式：分割线后自动续到下一行（回归：不上报揭示完成会永久卡死）', () => {
      const { container } = render(<Harness story={makeStory(KIN)} />)
      pump()
      expect(container.querySelector('hr.kin-divider')).not.toBeNull()
      expect(container.textContent).toContain('第二幕开始。') // 越过分割线继续流到选项
      expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    })

    it('line 模式：分割线后停住、三角亮，点击才出下一条', () => {
      const kin = '@text_speed(0)\n@step_mode("line")\n第一幕结束。\n@divider()\n第二幕开始。\n* [继续] -> END\n'
      const { container } = render(<Harness story={makeStory(kin)} />)
      pump(500, 50)
      act(() => { fireEvent.click(content(container)) }) // 出分割线
      pump(300, 50)
      expect(container.querySelector('hr.kin-divider')).not.toBeNull()
      expect(container.textContent).not.toContain('第二幕开始。') // 停在分割线这条内容上
      expect(container.querySelector('.advance-indicator')).not.toBeNull()
      act(() => { fireEvent.click(content(container)) })
      pump(300, 50)
      expect(container.textContent).toContain('第二幕开始。')
    })

    it('读档 / 重放（advance 排空路径）分割线确定性重现在正文历史里', () => {
      const r = advance(makeStory(KIN), initialState, RESOLVE)
      expect(r.state.log.filter((e) => e.kind === 'divider')).toHaveLength(1)
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
