import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewPane } from './PreviewPane'
import { emptyHost, type PlayState } from '@kiny/player'

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

const atChoice: PlayState = {
  log: [{ kind: 'narration', spans: [{ text: '开场。' }] }],
  host: emptyHost,
  choices: [{ spans: [{ text: 'A' }], index: 0 }, { spans: [{ text: 'B' }], index: 1 }],
  input: null, ended: false, error: null,
}

describe('PreviewPane', () => {
  it('渲染 Player；点选项以位置回调 onChoose', async () => {
    const onChoose = vi.fn()
    render(<PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={onChoose} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    expect(screen.getByText('开场。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('「← 上一步」按钮：canGoBack 时点触发 onBack、否则禁用（T044）', async () => {
    const onBack = vi.fn()
    const { rerender } = render(<PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={onBack} canGoBack={true} />)
    const back = screen.getByRole('button', { name: /上一步/ })
    expect(back).toBeEnabled()
    await userEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
    rerender(<PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={onBack} canGoBack={false} />)
    expect(screen.getByRole('button', { name: /上一步/ })).toBeDisabled() // seq 空（预览起点）→ 禁用
  })

  it('「⏩ 快进」开关：点击回调 onToggleFastForward；开着时按下态 + 工具栏亮「快进中」标记（T116）', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(<PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} onToggleFastForward={onToggle} />)
    const btn = screen.getByRole('button', { name: /快进/ })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('⏩ 快进中')).toBeNull()
    await userEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
    // 快进改变作品表现，开着时必须一眼可见——按下态 + 常驻标记两处都盯住。
    rerender(<PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} onToggleFastForward={onToggle} fastForward />)
    expect(screen.getByRole('button', { name: /快进/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('⏩ 快进中')).toBeInTheDocument()
  })

  it('停在 @input：输入框可用，回车提交以文本回调 onSubmitInput', async () => {
    const onSubmitInput = vi.fn()
    const atInput: PlayState = {
      log: [{ kind: 'narration', spans: [{ text: '请报上名来。' }] }],
      host: emptyHost, choices: [], input: { placeholder: '你的名字' }, ended: false, error: null,
    }
    render(<PreviewPane play={atInput} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={onSubmitInput} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    const box = screen.getByPlaceholderText('你的名字')
    expect(box).not.toBeDisabled() // 非禁用态（对比 T037 的禁用占位）
    await userEvent.type(box, '旅人{Enter}')
    expect(onSubmitInput).toHaveBeenCalledWith('旅人')
  })

  it('重开按钮回调 onRestart', async () => {
    const onRestart = vi.fn()
    render(<PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={onRestart} onBack={vi.fn()} canGoBack={false} />)
    await userEvent.click(screen.getByRole('button', { name: /重开预览/ }))
    expect(onRestart).toHaveBeenCalled()
  })

  it('stale=true 显示「基于上一个有效版本」角标', () => {
    render(<PreviewPane play={atChoice} stale seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    expect(screen.getByText(/基于上一个有效版本/)).toBeInTheDocument()
  })

  it('play.error 非空显示运行时错误横幅', () => {
    const errored: PlayState = { ...atChoice, choices: [], error: { message: '炸了', file: 'main.kin', line: 2 } }
    render(<PreviewPane play={errored} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    expect(screen.getByText(/运行时错误/)).toBeInTheDocument()
    expect(screen.getByText(/炸了/)).toBeInTheDocument()
  })

  it('play 为 null（尚无有效版本）显示占位', () => {
    render(<PreviewPane play={null} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    expect(screen.getByText(/暂无预览/)).toBeInTheDocument()
  })

  it('sfx 队列非空：透传到 Player 播放一次性音效', () => {
    render(<PreviewPane play={atChoice} stale={false} sfx={['mem://s.mp3']} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('种子指示器按传入 seed 渲染十六进制', () => {
    const { rerender } = render(
      <PreviewPane play={atChoice} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />,
    )
    expect(screen.getByText('种子 #5eed')).toBeInTheDocument()
    rerender(<PreviewPane play={atChoice} stale={false} seed={0xa3f10b2c} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()} onBack={vi.fn()} canGoBack={false} />)
    expect(screen.getByText('种子 #a3f10b2c')).toBeInTheDocument()
  })

  it('reveal 有值时最新一行走打字机揭示（未推进定时器前不整行可见）；点内容区触发 onContentClick', async () => {
    const onContentClick = vi.fn()
    const reveal = { speed: 5, fade: 100, skipToken: 0 }
    const long: PlayState = {
      log: [{ kind: 'narration', spans: [{ text: '这是一段用来验证揭示动画是否生效的长文字。' }] }],
      host: emptyHost, choices: [], input: null, ended: false, error: null,
    }
    render(
      <PreviewPane play={long} stale={false} seed={0x5eed} onChoose={vi.fn()} onSubmitInput={vi.fn()} onRestart={vi.fn()}
        onBack={vi.fn()} canGoBack={false} reveal={reveal} onContentClick={onContentClick} />,
    )
    expect(screen.queryByText('这是一段用来验证揭示动画是否生效的长文字。')).toBeNull()
    await userEvent.click(document.querySelector('.player-content')!)
    expect(onContentClick).toHaveBeenCalled()
  })
})
