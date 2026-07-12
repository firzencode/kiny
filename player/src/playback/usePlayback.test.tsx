import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { loadProjectFromFiles, analyze, resolveStart, createStory } from '@kiny/engine'
import type { Story } from '@kiny/engine'
import { usePlayback } from './usePlayback'
import { Player } from '../components/Player'
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
})
